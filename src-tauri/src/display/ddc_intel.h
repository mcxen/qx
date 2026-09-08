/* Intel framebuffer DDC/CI. Protocol reference: MonitorControl IntelDDC.swift
 * (MIT; attribution and license in display_macos.m). No enumeration-order binding.
 */
#import <IOKit/i2c/IOI2CInterface.h>

static io_service_t qx_intel_framebuffer(CGDirectDisplayID display) {
    io_iterator_t iterator = 0;
    if (IOServiceGetMatchingServices(MACH_PORT_NULL, IOServiceMatching("IOFramebuffer"), &iterator)) return 0;
    io_service_t found = 0, entry;
    bool ambiguous = false;
    while ((entry = IOIteratorNext(iterator))) {
        CFDictionaryRef info = IODisplayCreateInfoDictionary(entry, kIODisplayOnlyPreferredName);
        if (info) {
            uint32_t vendor = 0, product = 0, serial = 0;
            CFNumberRef v = CFDictionaryGetValue(info, CFSTR(kDisplayVendorID));
            CFNumberRef p = CFDictionaryGetValue(info, CFSTR(kDisplayProductID));
            CFNumberRef s = CFDictionaryGetValue(info, CFSTR(kDisplaySerialNumber));
            if (v && CFGetTypeID(v) == CFNumberGetTypeID()) CFNumberGetValue(v, kCFNumberSInt32Type, &vendor);
            if (p && CFGetTypeID(p) == CFNumberGetTypeID()) CFNumberGetValue(p, kCFNumberSInt32Type, &product);
            if (s && CFGetTypeID(s) == CFNumberGetTypeID()) CFNumberGetValue(s, kCFNumberSInt32Type, &serial);
            if (vendor == CGDisplayVendorNumber(display) && product == CGDisplayModelNumber(display) &&
                serial == CGDisplaySerialNumber(display)) {
                if (found) ambiguous = true;
                else { found = entry; IOObjectRetain(found); }
            }
            CFRelease(info);
        }
        IOObjectRelease(entry);
    }
    IOObjectRelease(iterator);
    if (ambiguous && found) { IOObjectRelease(found); return 0; }
    return found;
}

static bool qx_intel_transaction(CGDirectDisplayID display, uint8_t *packet, uint32_t length,
                                  uint8_t *reply, uint32_t *stage, int32_t *code) {
    io_service_t framebuffer = qx_intel_framebuffer(display);
    *stage = QX_DDC_STAGE_NO_ADAPTER;
    *code = 0;
    if (!framebuffer) return false;
    IOItemCount buses = 0;
    bool success = false;
    if (IOFBGetI2CInterfaceCount(framebuffer, &buses) == KERN_SUCCESS) {
        for (IOOptionBits bus = 0; bus < buses && !success; bus++) {
            io_service_t interface = 0;
            if (IOFBCopyI2CInterfaceForBus(framebuffer, bus, &interface)) continue;
            IOI2CConnectRef connect = NULL;
            IOReturn status = IOI2CInterfaceOpen(interface, 0, &connect);
            IOObjectRelease(interface);
            if (status) continue;
            for (int attempt = 0; attempt < 3 && !success; attempt++) {
                IOI2CRequest request = {0};
                request.sendAddress = 0x6e;
                request.sendTransactionType = kIOI2CSimpleTransactionType;
                request.sendBuffer = (vm_address_t)packet;
                request.sendBytes = length;
                request.replyAddress = 0x6f;
                request.replySubAddress = 0x51;
                request.replyTransactionType = reply ? (attempt == 2 ? kIOI2CSimpleTransactionType : kIOI2CDDCciReplyTransactionType) : kIOI2CNoTransactionType;
                request.replyBuffer = (vm_address_t)reply;
                request.replyBytes = reply ? 11 : 0;
                request.minReplyDelay = 50000000; // nanoseconds, 50 ms
                usleep(10000);
                status = IOI2CSendRequest(connect, 0, &request);
                *code = status ? status : request.result;
                success = *code == 0;
                if (success && reply) {
                    uint16_t current = 0, maximum = 0;
                    success = qx_ddc_decode(reply, 11, &current, &maximum);
                }
            }
            IOI2CInterfaceClose(connect, 0);
        }
    }
    IOObjectRelease(framebuffer);
    *stage = success ? 0 : (reply ? QX_DDC_STAGE_READ_RESPONSE : QX_DDC_STAGE_WRITE);
    return success;
}

static bool qx_intel_read(CGDirectDisplayID display, uint16_t *current, uint16_t *maximum,
                           uint32_t *stage, int32_t *code) {
    uint8_t packet[] = {0x51, 0x82, 1, 0x10, 0xac}, reply[11] = {0};
    if (!qx_intel_transaction(display, packet, sizeof(packet), reply, stage, code)) return false;
    *maximum = ((uint16_t)reply[6] << 8) | reply[7];
    *current = ((uint16_t)reply[8] << 8) | reply[9];
    if (!*maximum || *current > *maximum) { *stage = QX_DDC_STAGE_INVALID_RESPONSE; return false; }
    return true;
}

static int qx_intel_set(CGDirectDisplayID display, uint16_t percent, uint32_t *stage) {
    uint16_t current = 0, maximum = 0;
    int32_t code = 0;
    if (!qx_intel_read(display, &current, &maximum, stage, &code)) return code ? code : -1;
    uint16_t raw = ((uint32_t)percent * maximum + 50) / 100;
    uint8_t packet[] = {0x51, 0x84, 3, 0x10, raw >> 8, raw & 0xff, 0};
    packet[6] = 0x6e;
    for (size_t i = 0; i < 6; i++) packet[6] ^= packet[i];
    return qx_intel_transaction(display, packet, sizeof(packet), NULL, stage, &code) ? 0 : (code ? code : -1);
}
