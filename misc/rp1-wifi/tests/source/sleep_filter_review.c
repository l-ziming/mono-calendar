/* Compile the real whitelist builder; only basic host types are supplied. */
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef uint8_t t_u8;
typedef uint16_t t_u16;
typedef uint32_t t_u32;
typedef unsigned int t_size;
#define ARRAY_SIZE(a) (sizeof(a) / sizeof((a)[0]))
#include "sleep_builder.h"

int main(int argc, char **argv)
{
    t_u8 ipv4[4], mac[6], output[1024];
    assert(argc == 7 && strlen(argv[5]) == 12);
    for (int i = 0; i < 4; i++) {
        char *end;
        long octet = strtol(argv[i + 1], &end, 10);
        assert(!*end && octet >= 0 && octet <= 255);
        ipv4[i] = (t_u8)octet;
    }
    for (int i = 0; i < 6; i++) {
        char pair[3] = {argv[5][2 * i], argv[5][2 * i + 1], 0}, *end;
        long octet = strtol(pair, &end, 16);
        assert(end == pair + 2 && octet >= 0 && octet <= 255);
        mac[i] = (t_u8)octet;
    }
    assert(rp1_build_sleep_mef(NULL, sizeof(output), ipv4, mac) < 0);
    assert(rp1_build_sleep_mef(output, sizeof(output), NULL, mac) < 0);
    assert(rp1_build_sleep_mef(output, sizeof(output), ipv4, NULL) < 0);
    memset(output, 0xa5, sizeof(output));
    int length = rp1_build_sleep_mef(output, sizeof(output), ipv4, mac);
    assert(length == 356);
    for (size_t i = (size_t)length; i < sizeof(output); i++) assert(output[i] == 0xa5);
    for (int capacity = 0; capacity < length; capacity++) {
        t_u8 *short_output = malloc((size_t)capacity + 1);
        assert(short_output);
        memset(short_output, 0xa5, (size_t)capacity + 1);
        assert(rp1_build_sleep_mef(short_output, (t_size)capacity, ipv4, mac) < 0);
        for (int i = 0; i <= capacity; i++) assert(short_output[i] == 0xa5);
        free(short_output);
    }
    t_u8 *exact_output = malloc((size_t)length);
    assert(exact_output);
    assert(rp1_build_sleep_mef(exact_output, (t_size)length, ipv4, mac) == length);
    assert(!memcmp(output, exact_output, (size_t)length));
    free(exact_output);
    FILE *file = fopen(argv[6], "wb");
    assert(file && fwrite(output, 1, (size_t)length, file) == (size_t)length);
    assert(fclose(file) == 0);
    puts("PASS actual whitelist builder: all short capacities, exact capacity, null inputs and dynamic IPv4/MAC (ASan/UBSan)");
    return 0;
}
