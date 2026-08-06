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

typedef struct {
    uint32_t id;
    uint16_t current;
    uint16_t max;
    char name[256];
} QxDdcDisplay;

typedef struct {
    CGDirectDisplayID id;
    io_service_t adapter;
    CFStringRef location;
    CFStringRef productName;
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
        if (!CoreDisplay_DisplayCreateInfoDictionary) continue;
        CFDictionaryRef info = CoreDisplay_DisplayCreateInfoDictionary(id);
        if (!info) continue;
        CFStringRef location = CFDictionaryGetValue(info, CFSTR("IODisplayLocation"));
        if (!location || CFGetTypeID(location) != CFStringGetTypeID()) {
            CFRelease(info);
            continue;
        }
        io_service_t adapter = IORegistryEntryCopyFromPath(kIOMainPortDefault, location);
        if (adapter == MACH_PORT_NULL) {
            CFRelease(info);
            continue;
        }
        out[written].id = id;
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

static IOAVServiceRef qx_ddc_service(QxDisplayInfo *display, uint32_t *chip) {
    if (!display || !IOAVServiceCreateWithService) return NULL;
    uint64_t adapterId = 0;
    if (IORegistryEntryGetRegistryEntryID(display->adapter, &adapterId) != KERN_SUCCESS) return NULL;
    io_iterator_t iterator = MACH_PORT_NULL;
    io_registry_entry_t root = IORegistryGetRootEntry(kIOMainPortDefault);
    if (IORegistryEntryCreateIterator(root, kIOServicePlane, kIORegistryIterateRecursively, &iterator) != KERN_SUCCESS) return NULL;

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
        CFTypeRef location = qx_property(service, "Location");
        bool external = location && CFGetTypeID(location) == CFStringGetTypeID() &&
            CFStringCompare(location, CFSTR("External"), 0) == kCFCompareEqualTo;
        if (location) CFRelease(location);
        if (avService && external) {
            *chip = qx_mcdp_proxy(service) ? QX_DDC_MCDP29XX_CHIP : QX_DDC_DEFAULT_CHIP;
            IOObjectRelease(service);
            IOObjectRelease(iterator);
            return avService;
        }
        if (avService) CFRelease(avService);
        IOObjectRelease(service);
    }
    IOObjectRelease(iterator);
    return NULL;
}

static bool qx_ddc_packet_read(IOAVServiceRef service, uint32_t chip, uint16_t *current, uint16_t *max) {
    if (!service || !IOAVServiceWriteI2C || !IOAVServiceReadI2C) return false;
    uint8_t request[12] = {0};
    request[0] = 0x82;
    request[1] = 0x01;
    request[2] = 0x10;
    request[3] = 0x6e ^ request[0] ^ request[1] ^ request[2] ^ request[3];
    usleep(chip == QX_DDC_MCDP29XX_CHIP ? 50000 : QX_DDC_WAIT_US);
    if (IOAVServiceWriteI2C(service, chip, QX_DDC_INPUT_ADDRESS, request, 4) != 0) return false;
    usleep(chip == QX_DDC_MCDP29XX_CHIP ? 50000 : QX_DDC_WAIT_US);
    uint8_t response[12] = {0};
    if (IOAVServiceReadI2C(service, chip, QX_DDC_INPUT_ADDRESS, response, 12) != 0) return false;
    uint16_t maxValue = ((uint16_t)response[6] << 8) | response[7];
    uint16_t currentValue = ((uint16_t)response[8] << 8) | response[9];
    if (maxValue == 0 || currentValue > maxValue) return false;
    *max = maxValue;
    *current = currentValue;
    return true;
}

static bool qx_ddc_packet_write(IOAVServiceRef service, uint32_t chip, uint16_t value) {
    if (!service || !IOAVServiceWriteI2C) return false;
    uint8_t packet[6] = {0x84, 0x03, 0x10, (uint8_t)(value >> 8), (uint8_t)(value & 0xff), 0};
    packet[5] = 0x6e ^ QX_DDC_INPUT_ADDRESS ^ packet[0] ^ packet[1] ^ packet[2] ^ packet[3] ^ packet[4];
    for (int attempt = 0; attempt < 2; attempt++) {
        usleep(QX_DDC_WAIT_US);
        if (IOAVServiceWriteI2C(service, chip, QX_DDC_INPUT_ADDRESS, packet, sizeof(packet)) != 0) return false;
    }
    return true;
}

size_t qx_ddc_list(QxDdcDisplay *out, size_t capacity) {
    if (!out || capacity == 0) return 0;
    QxDisplayInfo displays[32] = {0};
    size_t count = qx_online_displays(displays, 32);
    size_t written = 0;
    for (size_t index = 0; index < count && written < capacity; index++) {
        if (CGDisplayIsBuiltin(displays[index].id)) continue;
        uint32_t chip = QX_DDC_DEFAULT_CHIP;
        IOAVServiceRef service = qx_ddc_service(&displays[index], &chip);
        if (!service) continue;
        uint16_t current = 0, max = 0;
        bool supported = qx_ddc_packet_read(service, chip, &current, &max);
        CFRelease(service);
        if (!supported) continue;
        out[written].id = displays[index].id;
        out[written].current = current;
        out[written].max = max;
        char fallback[64] = {0};
        snprintf(fallback, sizeof(fallback), "Display %u", displays[index].id);
        qx_copy_string(displays[index].productName, out[written].name, sizeof(out[written].name), fallback);
        written++;
    }
    qx_release_displays(displays, count);
    return written;
}

int qx_ddc_set(uint32_t display, uint16_t value) {
    QxDisplayInfo displays[32] = {0};
    size_t count = qx_online_displays(displays, 32);
    int result = -1;
    for (size_t index = 0; index < count; index++) {
        if (displays[index].id != display || CGDisplayIsBuiltin(display)) continue;
        uint32_t chip = QX_DDC_DEFAULT_CHIP;
        IOAVServiceRef service = qx_ddc_service(&displays[index], &chip);
        if (service) {
            result = qx_ddc_packet_write(service, chip, value);
            CFRelease(service);
        }
        break;
    }
    qx_release_displays(displays, count);
    return result;
}
