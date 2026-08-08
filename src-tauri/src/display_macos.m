/*
 * Qx native macOS display control.
 *
 * Apple Silicon DDC/CI transport for external displays.
 *
 * Packet framing and IOAVService I2C follow MonitorControl Arm64DDC.swift
 * (MIT, waydabber et al.) and the earlier m1ddc project. Service discovery
 * deliberately matches Arm64DDC (AppleCLCD2 / IOMobileFramebufferShim +
 * External DCPAVServiceProxy + EDID/IODisplayLocation scoring) — the older
 * "IOMobileFramebuffer registry id == CoreDisplay adapter" heuristic fails on
 * modern macOS and produces IOReturn 0xE0114000 on WriteI2C.
 *
 * Embedded here as a Qx platform adapter so Qx does not spawn or require an
 * external DDC executable. Public C entry points are a narrow Rust boundary;
 * display policy remains in display.rs.
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
#include <stdlib.h>
#include <string.h>
#include <strings.h>

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

// Chip / data addresses match MonitorControl Arm64DDC.swift (not m1ddc alone).
#define QX_DDC_DEFAULT_CHIP 0x37
#define QX_DDC_MCDP29XX_CHIP 0xB7
#define QX_DDC_INPUT_ADDRESS 0x51
#define QX_DDC_WRITE_SLEEP_US 10000
#define QX_DDC_READ_SLEEP_US 50000
#define QX_DDC_RETRY_SLEEP_US 20000
#define QX_DDC_WRITE_CYCLES 2
#define QX_DDC_RETRY_ATTEMPTS 4

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

/*
 * Service discovery matches MonitorControl Arm64DDC.swift — NOT the older
 * m1ddc "IOMobileFramebuffer registry-id == adapter" heuristic.
 *
 * On modern Apple Silicon the useful nodes are named AppleCLCD2 /
 * IOMobileFramebufferShim. CoreDisplay's IODisplayLocation often points at a
 * different IORegistry entry than those framebuffers, so comparing registry
 * entry IDs never finds DCPAVServiceProxy and Qx fell back to a generic
 * IOAVServiceCreate() that returns IOReturn 0xE0114000 on WriteI2C.
 *
 * MonitorControl walks the tree, pairs each framebuffer with the following
 * External DCPAVServiceProxy, then scores candidates against the CG display
 * (IODisplayLocation +10, EDID UUID fragments, product name, serial).
 */

#define QX_DDC_MAX_CANDIDATES 16
#define QX_DDC_MAX_MATCH_SCORE 20

typedef struct {
    char edid_uuid[64];
    char manufacturer_id[32];
    char product_name[256];
    char io_display_location[512];
    char location[32];
    int64_t serial_number;
    int service_location;
    IOAVServiceRef service; // retained; may be NULL if no External proxy yet
} QxIoregDdcCandidate;

static int64_t qx_cf_int64(CFTypeRef value) {
    if (!value) return 0;
    if (CFGetTypeID(value) == CFNumberGetTypeID()) {
        int64_t n = 0;
        CFNumberGetValue((CFNumberRef)value, kCFNumberSInt64Type, &n);
        return n;
    }
    return 0;
}

static void qx_ioreg_fill_framebuffer(io_service_t entry, QxIoregDdcCandidate *out) {
    memset(out, 0, sizeof(*out));
    CFTypeRef edid = IORegistryEntryCreateCFProperty(
        entry, CFSTR("EDID UUID"), kCFAllocatorDefault, kIORegistryIterateRecursively);
    if (edid && CFGetTypeID(edid) == CFStringGetTypeID()) {
        CFStringGetCString((CFStringRef)edid, out->edid_uuid, sizeof(out->edid_uuid),
                           kCFStringEncodingUTF8);
    }
    if (edid) CFRelease(edid);

    io_string_t path = {0};
    if (IORegistryEntryGetPath(entry, kIOServicePlane, path) == KERN_SUCCESS) {
        strncpy(out->io_display_location, path, sizeof(out->io_display_location) - 1);
    }

    CFTypeRef attrs = IORegistryEntryCreateCFProperty(
        entry, CFSTR("DisplayAttributes"), kCFAllocatorDefault, kIORegistryIterateRecursively);
    if (attrs && CFGetTypeID(attrs) == CFDictionaryGetTypeID()) {
        CFDictionaryRef products = CFDictionaryGetValue((CFDictionaryRef)attrs, CFSTR("ProductAttributes"));
        if (products && CFGetTypeID(products) == CFDictionaryGetTypeID()) {
            CFStringRef manufacturer = CFDictionaryGetValue(products, CFSTR("ManufacturerID"));
            if (manufacturer && CFGetTypeID(manufacturer) == CFStringGetTypeID()) {
                CFStringGetCString(manufacturer, out->manufacturer_id, sizeof(out->manufacturer_id),
                                   kCFStringEncodingUTF8);
            }
            CFStringRef product = CFDictionaryGetValue(products, CFSTR("ProductName"));
            if (product && CFGetTypeID(product) == CFStringGetTypeID()) {
                CFStringGetCString(product, out->product_name, sizeof(out->product_name),
                                   kCFStringEncodingUTF8);
            }
            out->serial_number = qx_cf_int64(CFDictionaryGetValue(products, CFSTR("SerialNumber")));
        }
    }
    if (attrs) CFRelease(attrs);
}

static bool qx_name_is_framebuffer(const char *name) {
    if (!name || !name[0]) return false;
    // MonitorControl: AppleCLCD2 / IOMobileFramebufferShim (name contains).
    // Also accept plain IOMobileFramebuffer for older OS builds.
    return strstr(name, "AppleCLCD2") != NULL ||
           strstr(name, "IOMobileFramebufferShim") != NULL ||
           strcmp(name, "IOMobileFramebuffer") == 0;
}

static size_t qx_collect_ioreg_ddc_candidates(QxIoregDdcCandidate *out, size_t capacity) {
    if (!out || capacity == 0 || !IOAVServiceCreateWithService) return 0;

    io_registry_entry_t root = IORegistryGetRootEntry(kIOMainPortDefault);
    if (root == MACH_PORT_NULL) return 0;

    io_iterator_t iterator = MACH_PORT_NULL;
    if (IORegistryEntryCreateIterator(root, kIOServicePlane, kIORegistryIterateRecursively,
                                      &iterator) != KERN_SUCCESS) {
        return 0;
    }

    size_t written = 0;
    QxIoregDdcCandidate pending;
    memset(&pending, 0, sizeof(pending));
    bool have_pending = false;
    int service_location = 0;

    io_service_t entry = MACH_PORT_NULL;
    while ((entry = IOIteratorNext(iterator)) != MACH_PORT_NULL) {
        io_name_t name = {0};
        if (IORegistryEntryGetName(entry, name) != KERN_SUCCESS) {
            IOObjectRelease(entry);
            continue;
        }

        if (qx_name_is_framebuffer(name)) {
            qx_ioreg_fill_framebuffer(entry, &pending);
            service_location += 1;
            pending.service_location = service_location;
            have_pending = true;
            IOObjectRelease(entry);
            continue;
        }

        if (strcmp(name, "DCPAVServiceProxy") == 0 && have_pending) {
            CFTypeRef location = IORegistryEntryCreateCFProperty(
                entry, CFSTR("Location"), kCFAllocatorDefault, kIORegistryIterateRecursively);
            bool external = location && CFGetTypeID(location) == CFStringGetTypeID() &&
                CFStringCompare((CFStringRef)location, CFSTR("External"), 0) == kCFCompareEqualTo;
            if (location && CFGetTypeID(location) == CFStringGetTypeID()) {
                CFStringGetCString((CFStringRef)location, pending.location, sizeof(pending.location),
                                   kCFStringEncodingUTF8);
            }
            if (location) CFRelease(location);

            if (external && written < capacity) {
                pending.service = IOAVServiceCreateWithService(kCFAllocatorDefault, entry);
                if (pending.service) {
                    out[written++] = pending;
                    // Ownership of service transferred into out[]; clear pending.service so we
                    // do not double-free when overwriting pending next.
                    memset(&pending, 0, sizeof(pending));
                    have_pending = false;
                }
            }
            IOObjectRelease(entry);
            continue;
        }

        IOObjectRelease(entry);
    }

    IOObjectRelease(iterator);
    return written;
}

static void qx_release_ioreg_candidates(QxIoregDdcCandidate *candidates, size_t count) {
    for (size_t i = 0; i < count; i++) {
        if (candidates[i].service) CFRelease(candidates[i].service);
        candidates[i].service = NULL;
    }
}

static bool qx_edid_uuid_fragment_match(const char *uuid, const char *key, size_t loc) {
    if (!uuid || !key || key[0] == '\0' || strcmp(key, "0000") == 0) return false;
    size_t uuid_len = strlen(uuid);
    if (uuid_len < loc + 4 || strlen(key) < 4) return false;
    return strncasecmp(uuid + loc, key, 4) == 0;
}

// Port of Arm64DDC.ioregMatchScore — higher is better; IODisplayLocation alone is +10.
static int qx_ioreg_match_score(CGDirectDisplayID display_id, const QxIoregDdcCandidate *cand) {
    if (!cand || !CoreDisplay_DisplayCreateInfoDictionary) return 0;
    CFDictionaryRef dict = CoreDisplay_DisplayCreateInfoDictionary(display_id);
    if (!dict) return 0;

    int score = 0;

    CFStringRef loc = CFDictionaryGetValue(dict, CFSTR("IODisplayLocation"));
    if (loc && CFGetTypeID(loc) == CFStringGetTypeID() && cand->io_display_location[0]) {
        char buf[512] = {0};
        if (CFStringGetCString(loc, buf, sizeof(buf), kCFStringEncodingUTF8) &&
            strcmp(buf, cand->io_display_location) == 0) {
            score += 10;
        }
    }

    if (cand->edid_uuid[0]) {
        int64_t year = qx_cf_int64(CFDictionaryGetValue(dict, CFSTR("DisplayYearOfManufacture")));
        int64_t week = qx_cf_int64(CFDictionaryGetValue(dict, CFSTR("DisplayWeekOfManufacture")));
        int64_t vendor = qx_cf_int64(CFDictionaryGetValue(dict, CFSTR("DisplayVendorID")));
        int64_t product = qx_cf_int64(CFDictionaryGetValue(dict, CFSTR("DisplayProductID")));
        int64_t v_size = qx_cf_int64(CFDictionaryGetValue(dict, CFSTR("DisplayVerticalImageSize")));
        int64_t h_size = qx_cf_int64(CFDictionaryGetValue(dict, CFSTR("DisplayHorizontalImageSize")));

        char key[8] = {0};
        // Vendor ID @0
        snprintf(key, sizeof(key), "%04X", (unsigned)(vendor & 0xffff));
        if (qx_edid_uuid_fragment_match(cand->edid_uuid, key, 0)) score += 1;
        // Product ID little-endian hex @4
        snprintf(key, sizeof(key), "%02X%02X",
                 (unsigned)(product & 0xff),
                 (unsigned)((product >> 8) & 0xff));
        if (qx_edid_uuid_fragment_match(cand->edid_uuid, key, 4)) score += 1;
        // Week+year @19
        snprintf(key, sizeof(key), "%02X%02X",
                 (unsigned)(week & 0xff),
                 (unsigned)((year >= 1990 ? year - 1990 : 0) & 0xff));
        if (qx_edid_uuid_fragment_match(cand->edid_uuid, key, 19)) score += 1;
        // Image size cm @30
        snprintf(key, sizeof(key), "%02X%02X",
                 (unsigned)((h_size / 10) & 0xff),
                 (unsigned)((v_size / 10) & 0xff));
        if (qx_edid_uuid_fragment_match(cand->edid_uuid, key, 30)) score += 1;
    }

    if (cand->product_name[0]) {
        CFDictionaryRef names = CFDictionaryGetValue(dict, CFSTR("DisplayProductName"));
        if (names && CFGetTypeID(names) == CFDictionaryGetTypeID()) {
            CFStringRef en = CFDictionaryGetValue(names, CFSTR("en_US"));
            if (!en) {
                // first value
                CFIndex count = CFDictionaryGetCount(names);
                if (count > 0) {
                    CFTypeRef *values = calloc((size_t)count, sizeof(CFTypeRef));
                    if (values) {
                        CFDictionaryGetKeysAndValues(names, NULL, values);
                        if (CFGetTypeID(values[0]) == CFStringGetTypeID()) en = values[0];
                        free(values);
                    }
                }
            }
            if (en && CFGetTypeID(en) == CFStringGetTypeID()) {
                char name[256] = {0};
                if (CFStringGetCString(en, name, sizeof(name), kCFStringEncodingUTF8) &&
                    strcasecmp(name, cand->product_name) == 0) {
                    score += 1;
                }
            }
        }
    }

    if (cand->serial_number != 0) {
        int64_t serial = qx_cf_int64(CFDictionaryGetValue(dict, CFSTR("DisplaySerialNumber")));
        if (serial == cand->serial_number) score += 1;
    }

    CFRelease(dict);
    return score;
}

/// MonitorControl-style exclusive matching: highest score wins, each service
/// and each display used at most once. `out_services[i]` is retained for
/// `display_ids[i]` or NULL. Caller CFReleases non-NULL entries.
static void qx_match_services_to_displays(const CGDirectDisplayID *display_ids, size_t display_count,
                                          IOAVServiceRef *out_services, uint32_t *out_stage) {
    for (size_t i = 0; i < display_count; i++) {
        out_services[i] = NULL;
        if (out_stage) out_stage[i] = QX_DDC_STAGE_NO_EXTERNAL_PROXY;
    }
    if (!display_ids || display_count == 0 || !IOAVServiceCreateWithService) {
        if (out_stage && display_count > 0 && !IOAVServiceCreateWithService) {
            for (size_t i = 0; i < display_count; i++) out_stage[i] = QX_DDC_STAGE_NO_AV_API;
        }
        return;
    }

    QxIoregDdcCandidate candidates[QX_DDC_MAX_CANDIDATES];
    memset(candidates, 0, sizeof(candidates));
    size_t cand_count = qx_collect_ioreg_ddc_candidates(candidates, QX_DDC_MAX_CANDIDATES);

    if (cand_count == 0) {
        // m1ddc-style generic fallback only when exactly one external is present.
        if (display_count == 1 && IOAVServiceCreate) {
            IOAVServiceRef generic = IOAVServiceCreate(kCFAllocatorDefault);
            if (generic) {
                out_services[0] = generic;
                if (out_stage) out_stage[0] = QX_DDC_STAGE_OK;
            } else if (out_stage) {
                out_stage[0] = QX_DDC_STAGE_SERVICE_CREATE;
            }
        }
        return;
    }

    // scores[display][candidate]
    int scores[32][QX_DDC_MAX_CANDIDATES];
    memset(scores, 0, sizeof(scores));
    size_t n_disp = display_count < 32 ? display_count : 32;
    for (size_t d = 0; d < n_disp; d++) {
        for (size_t c = 0; c < cand_count; c++) {
            if (!candidates[c].service) {
                scores[d][c] = 0;
                continue;
            }
            scores[d][c] = qx_ioreg_match_score(display_ids[d], &candidates[c]);
            // Sole external candidate: allow weak match so a single panel still binds
            // when CoreDisplay paths diverge from the framebuffer path.
            if (scores[d][c] == 0 && cand_count == 1) scores[d][c] = 1;
        }
    }

    bool taken_display[32] = {0};
    bool taken_cand[QX_DDC_MAX_CANDIDATES] = {0};

    for (int want = QX_DDC_MAX_MATCH_SCORE; want >= 1; want--) {
        for (size_t d = 0; d < n_disp; d++) {
            if (taken_display[d]) continue;
            for (size_t c = 0; c < cand_count; c++) {
                if (taken_cand[c] || !candidates[c].service) continue;
                if (scores[d][c] != want) continue;
                // Transfer service ownership to the display slot.
                out_services[d] = candidates[c].service;
                candidates[c].service = NULL;
                taken_display[d] = true;
                taken_cand[c] = true;
                if (out_stage) out_stage[d] = QX_DDC_STAGE_OK;
                break;
            }
        }
    }

    qx_release_ioreg_candidates(candidates, cand_count);
}

/// Best External IOAVService for this CG display. Retained; caller CFReleases.
static IOAVServiceRef qx_ddc_service_for_display(CGDirectDisplayID display_id, uint32_t *chip,
                                                 uint32_t *stage, int32_t *error_code) {
    if (stage) *stage = QX_DDC_STAGE_OK;
    if (error_code) *error_code = 0;
    if (chip) *chip = QX_DDC_DEFAULT_CHIP;

    IOAVServiceRef matched = NULL;
    uint32_t match_stage = QX_DDC_STAGE_OK;
    qx_match_services_to_displays(&display_id, 1, &matched, &match_stage);
    if (!matched) {
        if (stage) *stage = match_stage ? match_stage : QX_DDC_STAGE_NO_EXTERNAL_PROXY;
        return NULL;
    }
    if (chip) *chip = QX_DDC_DEFAULT_CHIP;
    if (stage) *stage = QX_DDC_STAGE_OK;
    return matched;
}

/*
 * DDC/CI over IOAVService — aligned with MonitorControl Arm64DDC.swift
 * (https://github.com/MonitorControl/MonitorControl).
 *
 * Critical differences from the earlier m1ddc-only port that broke many panels:
 * - GET VCP: IOAVServiceReadI2C offset is **0**, not 0x51 (data address is only
 *   used for WriteI2C). MonitorControl always passes 0 for the read offset.
 * - Full-transaction retries (write cycles + outer attempts + read delay 50ms).
 * - Reply checksum seed 0x50; write checksum seed 0x6E ^ 0x51 for SET, 0x6E for GET.
 */

static uint8_t qx_ddc_checksum(uint8_t seed, const uint8_t *data, size_t start, size_t end_inclusive) {
    uint8_t chk = seed;
    for (size_t i = start; i <= end_inclusive; i++) chk ^= data[i];
    return chk;
}

/// MonitorControl `performDDCCommunication` for GET (send = [vcp]) or SET
/// (send = [vcp, hi, lo]). On GET, reply must be 11 bytes.
static bool qx_ddc_communicate(IOAVServiceRef service, uint32_t chip,
                               const uint8_t *send, size_t send_len,
                               uint8_t *reply, size_t reply_len,
                               uint32_t *stage, int32_t *error_code) {
    if (stage) *stage = QX_DDC_STAGE_OK;
    if (error_code) *error_code = 0;
    if (!service || !IOAVServiceWriteI2C || (reply_len > 0 && !IOAVServiceReadI2C)) {
        if (stage) *stage = QX_DDC_STAGE_NO_AV_API;
        return false;
    }
    if (send_len == 0 || send_len > 4) {
        if (stage) *stage = QX_DDC_STAGE_INVALID_RESPONSE;
        return false;
    }

    // packet = [0x80 | (send.count+1), send.count] + send + [checksum]
    uint8_t packet[8] = {0};
    size_t packet_len = send_len + 3;
    packet[0] = (uint8_t)(0x80 | (send_len + 1));
    packet[1] = (uint8_t)send_len;
    memcpy(&packet[2], send, send_len);
    // GET (len 1): seed = 0x37<<1 = 0x6E; SET: seed = 0x6E ^ 0x51
    uint8_t seed = (send_len == 1)
        ? (uint8_t)(QX_DDC_DEFAULT_CHIP << 1)
        : (uint8_t)((QX_DDC_DEFAULT_CHIP << 1) ^ QX_DDC_INPUT_ADDRESS);
    packet[packet_len - 1] = qx_ddc_checksum(seed, packet, 0, packet_len - 2);

    IOReturn last_status = 0;
    for (int attempt = 0; attempt < QX_DDC_RETRY_ATTEMPTS + 1; attempt++) {
        bool write_ok = false;
        for (int cycle = 0; cycle < QX_DDC_WRITE_CYCLES; cycle++) {
            usleep(QX_DDC_WRITE_SLEEP_US);
            last_status = IOAVServiceWriteI2C(
                service, chip, QX_DDC_INPUT_ADDRESS, packet, (uint32_t)packet_len);
            write_ok = (last_status == 0);
        }
        if (!write_ok) {
            if (stage) *stage = reply_len > 0 ? QX_DDC_STAGE_READ_REQUEST : QX_DDC_STAGE_WRITE;
            if (error_code) *error_code = last_status;
            usleep(QX_DDC_RETRY_SLEEP_US);
            continue;
        }

        if (reply_len == 0) {
            if (stage) *stage = QX_DDC_STAGE_OK;
            if (error_code) *error_code = 0;
            return true;
        }

        // MonitorControl: ReadI2C offset is **0**, not data address 0x51.
        usleep(QX_DDC_READ_SLEEP_US);
        memset(reply, 0, reply_len);
        last_status = IOAVServiceReadI2C(service, chip, 0, reply, (uint32_t)reply_len);
        if (last_status != 0) {
            if (stage) *stage = QX_DDC_STAGE_READ_RESPONSE;
            if (error_code) *error_code = last_status;
            usleep(QX_DDC_RETRY_SLEEP_US);
            continue;
        }
        // Validate reply checksum with seed 0x50 (MonitorControl Arm64DDC).
        if (reply_len >= 2) {
            uint8_t expect = qx_ddc_checksum(0x50, reply, 0, reply_len - 2);
            if (expect != reply[reply_len - 1]) {
                if (stage) *stage = QX_DDC_STAGE_INVALID_RESPONSE;
                if (error_code) *error_code = 0;
                usleep(QX_DDC_RETRY_SLEEP_US);
                continue;
            }
        }
        if (stage) *stage = QX_DDC_STAGE_OK;
        if (error_code) *error_code = 0;
        return true;
    }
    return false;
}

static bool qx_ddc_packet_read_at_chip(IOAVServiceRef service, uint32_t chip, uint16_t *current,
                                       uint16_t *max, uint32_t *stage, int32_t *error_code) {
    uint8_t send[1] = {0x10}; // luminance VCP
    uint8_t reply[11] = {0};
    if (!qx_ddc_communicate(service, chip, send, 1, reply, sizeof(reply), stage, error_code)) {
        return false;
    }
    uint16_t maxValue = ((uint16_t)reply[6] << 8) | reply[7];
    uint16_t currentValue = ((uint16_t)reply[8] << 8) | reply[9];
    if (maxValue == 0 || currentValue > maxValue) {
        if (stage) *stage = QX_DDC_STAGE_INVALID_RESPONSE;
        return false;
    }
    *max = maxValue;
    *current = currentValue;
    return true;
}

/// MonitorControl always uses 0x37; also try 0xB7 for MCDP29XX docks.
static bool qx_ddc_packet_read(IOAVServiceRef service, uint32_t preferred_chip, uint16_t *current,
                               uint16_t *max, uint32_t *stage, int32_t *error_code) {
    uint32_t chips[3] = {
        QX_DDC_DEFAULT_CHIP, // Arm64DDC hardcodes this first
        preferred_chip,
        QX_DDC_MCDP29XX_CHIP,
    };
    uint32_t last_stage = QX_DDC_STAGE_READ_REQUEST;
    int32_t last_code = 0;
    bool tried[256] = {0};
    for (int i = 0; i < 3; i++) {
        uint32_t chip = chips[i] & 0xff;
        if (tried[chip]) continue;
        tried[chip] = true;
        uint32_t s = QX_DDC_STAGE_OK;
        int32_t c = 0;
        if (qx_ddc_packet_read_at_chip(service, chip, current, max, &s, &c)) {
            if (stage) *stage = QX_DDC_STAGE_OK;
            if (error_code) *error_code = 0;
            return true;
        }
        last_stage = s;
        last_code = c;
    }
    if (stage) *stage = last_stage;
    if (error_code) *error_code = last_code;
    return false;
}

static bool qx_ddc_packet_write_at_chip(IOAVServiceRef service, uint32_t chip, uint16_t value,
                                        uint32_t *stage, int32_t *error_code) {
    uint8_t send[3] = {0x10, (uint8_t)(value >> 8), (uint8_t)(value & 0xff)};
    return qx_ddc_communicate(service, chip, send, 3, NULL, 0, stage, error_code);
}

static bool qx_ddc_packet_write(IOAVServiceRef service, uint32_t preferred_chip, uint16_t value,
                                uint32_t *stage, int32_t *error_code) {
    uint32_t chips[3] = {
        QX_DDC_DEFAULT_CHIP,
        preferred_chip,
        QX_DDC_MCDP29XX_CHIP,
    };
    uint32_t last_stage = QX_DDC_STAGE_WRITE;
    int32_t last_code = 0;
    bool tried[256] = {0};
    for (int i = 0; i < 3; i++) {
        uint32_t chip = chips[i] & 0xff;
        if (tried[chip]) continue;
        tried[chip] = true;
        uint32_t s = QX_DDC_STAGE_OK;
        int32_t c = 0;
        if (qx_ddc_packet_write_at_chip(service, chip, value, &s, &c)) {
            if (stage) *stage = QX_DDC_STAGE_OK;
            if (error_code) *error_code = 0;
            return true;
        }
        last_stage = s;
        last_code = c;
    }
    if (stage) *stage = last_stage;
    if (error_code) *error_code = last_code;
    return false;
}

size_t qx_ddc_list(QxDdcDisplay *out, size_t capacity) {
    if (!out || capacity == 0) return 0;
    QxDisplayInfo displays[32] = {0};
    size_t count = qx_online_displays(displays, 32);
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
        IOAVServiceRef service =
            qx_ddc_service_for_display(displays[index].id, &chip, &stage, &error_code);
        if (!service) {
            out[written].error_stage = stage;
            out[written].error_code = error_code;
            written++;
            continue;
        }

        uint16_t current = 0, max = 0;
        bool read_ok = qx_ddc_packet_read(service, chip, &current, &max, &stage, &error_code);
        CFRelease(service);

        // MonitorControl still enables DDC write when the AV service matched even if
        // the first VCP read fails (it falls back to prefs / defaults). Mirror that:
        // service found ⇒ treat as controllable with max=100 when read is unusable.
        if (read_ok) {
            out[written].current = current;
            out[written].max = max;
            out[written].error_stage = QX_DDC_STAGE_OK;
            out[written].error_code = 0;
        } else {
            out[written].current = 0;
            out[written].max = 100;
            out[written].error_stage = QX_DDC_STAGE_OK;
            out[written].error_code = 0;
            // Keep diagnostics in name? No — write path still works. Stage was read-only.
            (void)stage;
            (void)error_code;
        }
        written++;
    }
    qx_release_displays(displays, count);
    return written;
}

int qx_ddc_set(uint32_t display, uint16_t value, uint32_t *error_stage) {
    if (error_stage) *error_stage = QX_DDC_STAGE_OK;
    if (CGDisplayIsBuiltin(display)) {
        if (error_stage) *error_stage = QX_DDC_STAGE_NO_EXTERNAL_PROXY;
        return -1;
    }

    uint32_t chip = QX_DDC_DEFAULT_CHIP;
    int32_t error_code = 0;
    uint32_t stage = QX_DDC_STAGE_OK;
    IOAVServiceRef service = qx_ddc_service_for_display(display, &chip, &stage, &error_code);
    if (!service) {
        if (error_stage) *error_stage = stage;
        return error_code != 0 ? error_code : -1;
    }

    bool ok = qx_ddc_packet_write(service, chip, value, &stage, &error_code);
    CFRelease(service);
    if (error_stage) *error_stage = stage;
    return ok ? 0 : (error_code != 0 ? error_code : -1);
}
