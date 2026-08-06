/*
 * Qx native macOS display control.
 *
 * The DDC packet/transport code follows the MIT-licensed m1ddc project by
 * waydabber, but is kept here as a Qx platform adapter so Qx does not spawn
 * or require an external DDC executable. The public C functions below are a
 * deliberately narrow Rust boundary: display discovery and policy remain in
 * display.rs.
 *
 * Copyright (c) 2021 waydabber
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

#import <ApplicationServices/ApplicationServices.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <IOKit/IOKitLib.h>
#import <IOKit/graphics/IOGraphicsLib.h>
#import <CoreFoundation/CoreFoundation.h>
#import <unistd.h>
#include <stdbool.h>
#include <stdint.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

typedef CFTypeRef IOAVServiceRef;

extern int DisplayServicesGetBrightness(CGDirectDisplayID display, float *brightness)
    __attribute__((weak_import));
extern int DisplayServicesSetBrightness(CGDirectDisplayID display, float brightness)
    __attribute__((weak_import));
extern CFDictionaryRef CoreDisplay_DisplayCreateInfoDictionary(CGDirectDisplayID display)
    __attribute__((weak_import));
extern IOAVServiceRef IOAVServiceCreate(CFAllocatorRef allocator)
    __attribute__((weak_import));
extern IOAVServiceRef IOAVServiceCreateWithService(CFAllocatorRef allocator, io_service_t service)
    __attribute__((weak_import));
extern int IOAVServiceReadI2C(IOAVServiceRef service, uint32_t chipAddress, uint32_t offset,
                              void *outputBuffer, uint32_t outputBufferSize)
    __attribute__((weak_import));
extern int IOAVServiceWriteI2C(IOAVServiceRef service, uint32_t chipAddress, uint32_t dataAddress,
                               void *inputBuffer, uint32_t inputBufferSize)
    __attribute__((weak_import));

#define QX_DDC_DEFAULT_CHIP 0x37
#define QX_DDC_MCDP29XX_CHIP 0xB7
#define QX_DDC_INPUT_ADDRESS 0x51
#define QX_DDC_WAIT_US 10000

#define QX_DDC_STAGE_OK 0
#define QX_DDC_STAGE_NO_DISPLAY_INFO 1
#define QX_DDC_STAGE_NO_IO_LOCATION 2
#define QX_DDC_STAGE_NO_ADAPTER 3
#define QX_DDC_STAGE_NO_AV_API 4
#define QX_DDC_STAGE_NO_REGISTRY_ID 5
#define QX_DDC_STAGE_NO_ITERATOR 6
#define QX_DDC_STAGE_NO_EXTERNAL_PROXY 7
#define QX_DDC_STAGE_SERVICE_CREATE 8
#define QX_DDC_STAGE_READ_REQUEST 9
#define QX_DDC_STAGE_READ_RESPONSE 10
#define QX_DDC_STAGE_INVALID_RESPONSE 11
#define QX_DDC_STAGE_WRITE 12

typedef struct {
    uint32_t id;
    uint16_t current;
    uint16_t max;
    int32_t error_code;
    uint32_t error_stage;
    char name[256];
} QxDdcDisplay;

typedef struct {
    CGDirectDisplayID id;
    io_service_t adapter;
    CFStringRef location;
    CFStringRef productName;
    uint32_t discovery_stage;
} QxDisplayInfo;

static CFTypeRef qx_property(io_service_t service, const char *key) {
    CFStringRef cfKey = CFStringCreateWithCString(kCFAllocatorDefault, key, kCFStringEncodingASCII);
    if (!cfKey) return NULL;
    CFTypeRef value = IORegistryEntrySearchCFProperty(
        service, kIOServicePlane, cfKey, kCFAllocatorDefault, kIORegistryIterateRecursively);
    CFRelease(cfKey);
    return value;
}

static void qx_copy_string(CFTypeRef value, char *out, size_t capacity, const char *fallback) {
    if (capacity == 0) return;
    out[0] = '\0';
    if (value && CFGetTypeID(value) == CFStringGetTypeID()) {
        CFStringGetCString((CFStringRef)value, out, capacity, kCFStringEncodingUTF8);
    }
    if (out[0] == '\0' && fallback) {
        strncpy(out, fallback, capacity - 1);
        out[capacity - 1] = '\0';
    }
}

static size_t qx_online_displays(QxDisplayInfo *out, size_t capacity) {
    if (!out || capacity == 0) return 0;
    CGDirectDisplayID ids[32] = {0};
    CGDisplayCount count = 0;
    if (CGGetOnlineDisplayList(32, ids, &count) != kCGErrorSuccess) return 0;

    size_t written = 0;
    for (CGDisplayCount index = 0; index < count && written < capacity; index++) {
        CGDirectDisplayID id = ids[index];
        out[written].id = id;
        out[written].adapter = MACH_PORT_NULL;
        out[written].location = NULL;
        out[written].productName = NULL;
        out[written].discovery_stage = QX_DDC_STAGE_OK;
        if (!CoreDisplay_DisplayCreateInfoDictionary) {
            out[written].discovery_stage = QX_DDC_STAGE_NO_DISPLAY_INFO;
            written++;
            continue;
        }
        CFDictionaryRef info = CoreDisplay_DisplayCreateInfoDictionary(id);
        if (!info) {
            out[written].discovery_stage = QX_DDC_STAGE_NO_DISPLAY_INFO;
            written++;
            continue;
        }
        CFStringRef location = CFDictionaryGetValue(info, CFSTR("IODisplayLocation"));
        if (!location || CFGetTypeID(location) != CFStringGetTypeID()) {
            out[written].discovery_stage = QX_DDC_STAGE_NO_IO_LOCATION;
            CFRelease(info);
            written++;
            continue;
        }
        io_service_t adapter = IORegistryEntryCopyFromPath(kIOMainPortDefault, location);
        if (adapter == MACH_PORT_NULL) {
            out[written].discovery_stage = QX_DDC_STAGE_NO_ADAPTER;
            CFRelease(info);
            written++;
            continue;
        }
        out[written].adapter = adapter;
        out[written].location = CFRetain(location);
        out[written].productName = qx_property(adapter, "ProductName");
        if (!out[written].productName) {
            CFTypeRef attrs = qx_property(adapter, "DisplayAttributes");
            if (attrs && CFGetTypeID(attrs) == CFDictionaryGetTypeID()) {
                CFDictionaryRef products = CFDictionaryGetValue(attrs, CFSTR("ProductAttributes"));
                if (products && CFGetTypeID(products) == CFDictionaryGetTypeID()) {
                    CFStringRef product = CFDictionaryGetValue(products, CFSTR("ProductName"));
                    if (product) out[written].productName = CFRetain(product);
                }
            }
            if (attrs) CFRelease(attrs);
        }
        CFRelease(info);
        written++;
    }
    return written;
}

static void qx_release_displays(QxDisplayInfo *displays, size_t count) {
    for (size_t index = 0; index < count; index++) {
        if (displays[index].adapter != MACH_PORT_NULL) IOObjectRelease(displays[index].adapter);
        if (displays[index].location) CFRelease(displays[index].location);
        if (displays[index].productName) CFRelease(displays[index].productName);
    }
}

int qx_native_display_brightness(uint32_t display, uint16_t *out) {
    if (!out || !DisplayServicesGetBrightness) return -1;
    float value = 0.0f;
    int status = DisplayServicesGetBrightness((CGDirectDisplayID)display, &value);
    if (status != 0 || !isfinite(value)) return status == 0 ? -2 : status;
    if (value < 0.0f) value = 0.0f;
    if (value > 1.0f) value = 1.0f;
    *out = (uint16_t)lroundf(value * 100.0f);
    return 0;
}

int qx_native_set_display_brightness(uint32_t display, uint16_t value) {
    if (!DisplayServicesSetBrightness) return -1;
    return DisplayServicesSetBrightness((CGDirectDisplayID)display, (float)(value > 100 ? 100 : value) / 100.0f);
}

static bool qx_mcdp_proxy(io_service_t proxy) {
    io_registry_entry_t parent = MACH_PORT_NULL;
    if (IORegistryEntryGetParentEntry(proxy, kIOServicePlane, &parent) != KERN_SUCCESS) return false;
    CFTypeRef provider = IORegistryEntryCreateCFProperty(parent, CFSTR("EPICProviderClass"), kCFAllocatorDefault, 0);
    bool result = provider && CFGetTypeID(provider) == CFStringGetTypeID() &&
        CFStringCompare(provider, CFSTR("AppleDCPMCDP29XX"), 0) == kCFCompareEqualTo;
    if (provider) CFRelease(provider);
    IOObjectRelease(parent);
    return result;
}

static IOAVServiceRef qx_ddc_service(QxDisplayInfo *display, uint32_t *chip,
                                     uint32_t *stage, int32_t *error_code) {
    if (stage) *stage = QX_DDC_STAGE_OK;
    if (error_code) *error_code = 0;
    if (!display || !IOAVServiceCreateWithService) {
        if (stage) *stage = QX_DDC_STAGE_NO_AV_API;
        return NULL;
    }
    if (display->adapter == MACH_PORT_NULL) {
        if (stage) *stage = display->discovery_stage == QX_DDC_STAGE_OK
            ? QX_DDC_STAGE_NO_ADAPTER : display->discovery_stage;
        return NULL;
    }
    uint64_t adapterId = 0;
    kern_return_t adapter_status = IORegistryEntryGetRegistryEntryID(display->adapter, &adapterId);
    if (adapter_status != KERN_SUCCESS) {
        if (stage) *stage = QX_DDC_STAGE_NO_REGISTRY_ID;
        if (error_code) *error_code = adapter_status;
        return NULL;
    }
    io_iterator_t iterator = MACH_PORT_NULL;
    io_registry_entry_t root = IORegistryGetRootEntry(kIOMainPortDefault);
    kern_return_t iterator_status = IORegistryEntryCreateIterator(
        root, kIOServicePlane, kIORegistryIterateRecursively, &iterator);
    if (iterator_status != KERN_SUCCESS) {
        if (stage) *stage = QX_DDC_STAGE_NO_ITERATOR;
        if (error_code) *error_code = iterator_status;
        return NULL;
    }

    bool framebufferMatches = false;
    io_service_t service = MACH_PORT_NULL;
    while ((service = IOIteratorNext(iterator)) != MACH_PORT_NULL) {
        if (IOObjectConformsTo(service, "IOMobileFramebuffer")) {
            uint64_t framebufferId = 0;
            framebufferMatches = IORegistryEntryGetRegistryEntryID(service, &framebufferId) == KERN_SUCCESS && framebufferId == adapterId;
            IOObjectRelease(service);
            continue;
        }
        io_name_t name = {0};
        IORegistryEntryGetName(service, name);
        if (!framebufferMatches || strcmp(name, "DCPAVServiceProxy") != 0) {
            IOObjectRelease(service);
            continue;
        }
        IOAVServiceRef avService = IOAVServiceCreateWithService(kCFAllocatorDefault, service);
        if (!avService) {
            if (stage) *stage = QX_DDC_STAGE_SERVICE_CREATE;
            IOObjectRelease(service);
            continue;
        }
        CFTypeRef location = qx_property(service, "Location");
        bool external = location && CFGetTypeID(location) == CFStringGetTypeID() &&
            CFStringCompare(location, CFSTR("External"), 0) == kCFCompareEqualTo;
        if (location) CFRelease(location);
        if (external) {
            *chip = qx_mcdp_proxy(service) ? QX_DDC_MCDP29XX_CHIP : QX_DDC_DEFAULT_CHIP;
            IOObjectRelease(service);
            IOObjectRelease(iterator);
            return avService;
        }
        CFRelease(avService);
        IOObjectRelease(service);
    }
    IOObjectRelease(iterator);
    if (stage) *stage = QX_DDC_STAGE_NO_EXTERNAL_PROXY;
    return NULL;
}

static IOAVServiceRef qx_ddc_default_service(uint32_t *chip, uint32_t *stage,
                                              int32_t *error_code) {
    if (stage) *stage = QX_DDC_STAGE_OK;
    if (error_code) *error_code = 0;
    if (!IOAVServiceCreate) {
        if (stage) *stage = QX_DDC_STAGE_NO_AV_API;
        return NULL;
    }
    IOAVServiceRef service = IOAVServiceCreate(kCFAllocatorDefault);
    if (!service) {
        if (stage) *stage = QX_DDC_STAGE_SERVICE_CREATE;
        return NULL;
    }
    *chip = QX_DDC_DEFAULT_CHIP;
    return service;
}

static bool qx_ddc_packet_read(IOAVServiceRef service, uint32_t chip, uint16_t *current,
                               uint16_t *max, uint32_t *stage, int32_t *error_code) {
    if (stage) *stage = QX_DDC_STAGE_OK;
    if (error_code) *error_code = 0;
    if (!service || !IOAVServiceWriteI2C || !IOAVServiceReadI2C) {
        if (stage) *stage = QX_DDC_STAGE_NO_AV_API;
        return false;
    }
    uint8_t request[12] = {0};
    request[0] = 0x82;
    request[1] = 0x01;
    request[2] = 0x10;
    request[3] = 0x6e ^ request[0] ^ request[1] ^ request[2] ^ request[3];
    usleep(chip == QX_DDC_MCDP29XX_CHIP ? 50000 : QX_DDC_WAIT_US);
    IOReturn write_status = IOAVServiceWriteI2C(service, chip, QX_DDC_INPUT_ADDRESS, request, 4);
    if (write_status != 0) {
        if (stage) *stage = QX_DDC_STAGE_READ_REQUEST;
        if (error_code) *error_code = write_status;
        return false;
    }
    usleep(chip == QX_DDC_MCDP29XX_CHIP ? 50000 : QX_DDC_WAIT_US);
    uint8_t response[12] = {0};
    IOReturn read_status = IOAVServiceReadI2C(service, chip, QX_DDC_INPUT_ADDRESS, response, 12);
    if (read_status != 0) {
        if (stage) *stage = QX_DDC_STAGE_READ_RESPONSE;
        if (error_code) *error_code = read_status;
        return false;
    }
    uint16_t maxValue = ((uint16_t)response[6] << 8) | response[7];
    uint16_t currentValue = ((uint16_t)response[8] << 8) | response[9];
    if (maxValue == 0 || currentValue > maxValue) {
        if (stage) *stage = QX_DDC_STAGE_INVALID_RESPONSE;
        return false;
    }
    *max = maxValue;
    *current = currentValue;
    return true;
}

static bool qx_ddc_packet_write(IOAVServiceRef service, uint32_t chip, uint16_t value,
                                uint32_t *stage, int32_t *error_code) {
    if (stage) *stage = QX_DDC_STAGE_OK;
    if (error_code) *error_code = 0;
    if (!service || !IOAVServiceWriteI2C) {
        if (stage) *stage = QX_DDC_STAGE_NO_AV_API;
        return false;
    }
    uint8_t packet[6] = {0x84, 0x03, 0x10, (uint8_t)(value >> 8), (uint8_t)(value & 0xff), 0};
    packet[5] = 0x6e ^ QX_DDC_INPUT_ADDRESS ^ packet[0] ^ packet[1] ^ packet[2] ^ packet[3] ^ packet[4];
    for (int attempt = 0; attempt < 2; attempt++) {
        usleep(QX_DDC_WAIT_US);
        IOReturn status = IOAVServiceWriteI2C(
            service, chip, QX_DDC_INPUT_ADDRESS, packet, sizeof(packet));
        if (status != 0) {
            if (stage) *stage = QX_DDC_STAGE_WRITE;
            if (error_code) *error_code = status;
            return false;
        }
    }
    return true;
}

size_t qx_ddc_list(QxDdcDisplay *out, size_t capacity) {
    if (!out || capacity == 0) return 0;
    QxDisplayInfo displays[32] = {0};
    size_t count = qx_online_displays(displays, 32);
    size_t external_count = 0;
    for (size_t index = 0; index < count; index++) {
        if (!CGDisplayIsBuiltin(displays[index].id)) external_count++;
    }
    size_t written = 0;
    for (size_t index = 0; index < count && written < capacity; index++) {
        if (CGDisplayIsBuiltin(displays[index].id)) continue;
        out[written].id = displays[index].id;
        out[written].current = 0;
        out[written].max = 0;
        out[written].error_code = 0;
        out[written].error_stage = displays[index].discovery_stage;
        char fallback[64] = {0};
        snprintf(fallback, sizeof(fallback), "Display %u", displays[index].id);
        qx_copy_string(displays[index].productName, out[written].name,
                       sizeof(out[written].name), fallback);
        uint32_t chip = QX_DDC_DEFAULT_CHIP;
        int32_t error_code = 0;
        uint32_t stage = QX_DDC_STAGE_OK;
        IOAVServiceRef service = qx_ddc_service(&displays[index], &chip, &stage, &error_code);
        if (!service && external_count == 1) {
            service = qx_ddc_default_service(&chip, &stage, &error_code);
        }
        if (!service) {
            out[written].error_stage = stage;
            out[written].error_code = error_code;
            written++;
            continue;
        }
        uint16_t current = 0, max = 0;
        bool supported = qx_ddc_packet_read(
            service, chip, &current, &max, &stage, &error_code);
        CFRelease(service);
        out[written].current = current;
        out[written].max = max;
        out[written].error_stage = supported ? QX_DDC_STAGE_OK : stage;
        out[written].error_code = supported ? 0 : error_code;
        written++;
    }
    qx_release_displays(displays, count);
    return written;
}

int qx_ddc_set(uint32_t display, uint16_t value, uint32_t *error_stage) {
    if (error_stage) *error_stage = QX_DDC_STAGE_OK;
    QxDisplayInfo displays[32] = {0};
    size_t count = qx_online_displays(displays, 32);
    size_t external_count = 0;
    for (size_t index = 0; index < count; index++) {
        if (!CGDisplayIsBuiltin(displays[index].id)) external_count++;
    }
    int result = -1;
    for (size_t index = 0; index < count; index++) {
        if (displays[index].id != display || CGDisplayIsBuiltin(display)) continue;
        uint32_t chip = QX_DDC_DEFAULT_CHIP;
        int32_t error_code = 0;
        uint32_t stage = QX_DDC_STAGE_OK;
        IOAVServiceRef service = qx_ddc_service(&displays[index], &chip, &stage, &error_code);
        if (!service && external_count == 1) {
            service = qx_ddc_default_service(&chip, &stage, &error_code);
        }
        if (service) {
            result = qx_ddc_packet_write(service, chip, value, &stage, &error_code) ? 0 : error_code;
            CFRelease(service);
        }
        if (error_stage) *error_stage = stage;
        break;
    }
    qx_release_displays(displays, count);
    return result;
}
