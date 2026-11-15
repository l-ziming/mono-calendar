/* Real programming function with only its allocation/firmware boundary stubbed. */
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef uint8_t t_u8;
typedef uint16_t t_u16;
typedef uint32_t t_u32;
typedef unsigned int t_size;
typedef int mlan_status;
enum { MLAN_STATUS_FAILURE = -1, MLAN_STATUS_SUCCESS, MLAN_STATUS_PENDING };
#define ARRAY_SIZE(a) (sizeof(a) / sizeof((a)[0]))
#define MLAN_IOCTL_MISC_CFG 0x200000
#define MLAN_ACT_SET 1
#define MLAN_OID_MISC_MEF_CFG 0x200015
#define MEF_CFG_DISABLE 0
#define MEF_CFG_HOSTCMD 0xffff
#define MOAL_NO_WAIT 0
#define MOAL_IOCTL_WAIT_TIMEOUT 2
typedef struct { t_u32 len; t_u8 cmd[2048]; } mlan_ds_misc_cmd;
typedef struct {
    t_u32 sub_command;
    struct { struct { t_u32 sub_id; struct { mlan_ds_misc_cmd cmd_buf; } param; } mef_cfg; } param;
} mlan_ds_misc_cfg;
typedef struct { t_u32 req_id, action; void *pbuf; } mlan_ioctl_req;
struct net_device { t_u8 dev_addr[6]; };
typedef struct { struct net_device *netdev; } moal_private;

static int live_count, frees, requests;
static bool alloc_fail;
static mlan_status reply;
static mlan_ioctl_req *pending;
static mlan_ds_misc_cfg observed;

static mlan_ioctl_req *woal_alloc_mlan_ioctl_req(size_t size)
{
    if (alloc_fail) return NULL;
    mlan_ioctl_req *req = calloc(1, sizeof(*req) + size);
    assert(req && !live_count);
    req->pbuf = req + 1;
    live_count++;
    return req;
}

static void kfree(void *req)
{
    assert(req && live_count == 1);
    live_count--;
    frees++;
    free(req);
}

static mlan_status woal_request_ioctl(moal_private *priv, mlan_ioctl_req *req, t_u8 wait)
{
    assert(priv && req->req_id == MLAN_IOCTL_MISC_CFG && req->action == MLAN_ACT_SET);
    assert(wait == MOAL_IOCTL_WAIT_TIMEOUT);
    observed = *(mlan_ds_misc_cfg *)req->pbuf;
    assert(observed.sub_command == MLAN_OID_MISC_MEF_CFG);
    requests++;
    if (reply == MLAN_STATUS_PENDING) pending = req;
    return reply;
}

#include "sleep_builder.h"
#include "sleep_program.h"

int main(void)
{
    struct net_device netdev = {{0x02, 0, 0, 0, 0, 4}};
    moal_private priv = {&netdev};
    const t_u8 ipv4[4] = {10, 21, 34, 56};
    t_u8 expected[1024];
    int length = rp1_build_sleep_mef(expected, sizeof(expected), ipv4, netdev.dev_addr);
    assert(length > 0);
    reply = MLAN_STATUS_SUCCESS;
    assert(rp1_filter_program(&priv, ipv4, true) == MLAN_STATUS_SUCCESS);
    assert(requests == 1 && frees == 1 && !live_count);
    assert(observed.param.mef_cfg.sub_id == MEF_CFG_HOSTCMD);
    mlan_ds_misc_cmd *cmd = &observed.param.mef_cfg.param.cmd_buf;
    assert(cmd->len == (unsigned)length + 6 && cmd->cmd[0] == 11);
    assert(!cmd->cmd[1] && !cmd->cmd[2] && !cmd->cmd[3]);
    assert(cmd->cmd[4] == 7 && !cmd->cmd[5]);
    assert(!memcmp(cmd->cmd + 6, expected, (size_t)length));
    assert(rp1_filter_program(&priv, NULL, false) == MLAN_STATUS_SUCCESS);
    assert(observed.param.mef_cfg.sub_id == MEF_CFG_DISABLE && frees == 2 && !live_count);
    netdev.dev_addr[5] ^= 1;
    length = rp1_build_sleep_mef(expected, sizeof(expected), ipv4, netdev.dev_addr);
    assert(rp1_filter_program(&priv, ipv4, true) == MLAN_STATUS_SUCCESS);
    assert(cmd->cmd[4] == 7 && cmd->len == (unsigned)length + 6);
    assert(!memcmp(cmd->cmd + 6, expected, (size_t)length));
    puts("PASS actual programming sends seven-entry whitelist with the current netdev MAC and a real disable command");

    reply = MLAN_STATUS_FAILURE;
    assert(rp1_filter_program(&priv, ipv4, true) == MLAN_STATUS_FAILURE);
    assert(frees == 4 && !live_count);
    alloc_fail = true;
    assert(rp1_filter_program(&priv, ipv4, true) == MLAN_STATUS_FAILURE);
    assert(requests == 4 && frees == 4 && !live_count);
    alloc_fail = false;
    reply = MLAN_STATUS_PENDING;
    assert(rp1_filter_program(&priv, ipv4, true) == MLAN_STATUS_PENDING);
    assert(pending && live_count == 1 && frees == 4);
    /* Firmware completion owns this detached request; the caller must not free it. */
    kfree(pending);
    pending = NULL;
    assert(frees == 5 && !live_count);
    puts("PASS allocation/failure cleanup and PENDING ownership are preserved (ASan/UBSan)");
    return 0;
}
