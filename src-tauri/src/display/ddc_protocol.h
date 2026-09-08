/* Platform-independent DDC reply and exclusive matching validation. */
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

static bool qx_ddc_decode(const uint8_t *reply, size_t length, uint16_t *current, uint16_t *maximum) {
    if (length != 11 || reply[0] != 0x6e || (reply[1] & 0x7f) != 8 ||
        reply[2] != 2 || reply[3] != 0 || reply[4] != 0x10 || reply[5] != 0) return false;
    uint8_t checksum = 0x50;
    for (size_t i = 0; i < length; i++) checksum ^= reply[i];
    if (checksum) return false;
    uint16_t max_value = ((uint16_t)reply[6] << 8) | reply[7];
    uint16_t current_value = ((uint16_t)reply[8] << 8) | reply[9];
    if (!max_value || current_value > max_value) return false;
    *maximum = max_value;
    *current = current_value;
    return true;
}

static bool qx_ddc_unique_match(const int *scores, size_t stride, size_t displays, size_t candidates,
                                 const bool *used_displays, const bool *used_candidates, size_t d, size_t c) {
    int score = scores[d * stride + c];
    if (score <= 0 || used_displays[d] || used_candidates[c]) return false;
    for (size_t other = 0; other < candidates; other++) {
        if (other != c && !used_candidates[other] && scores[d * stride + other] >= score) return false;
    }
    for (size_t other = 0; other < displays; other++) {
        if (other != d && !used_displays[other] && scores[other * stride + c] >= score) return false;
    }
    return true;
}
