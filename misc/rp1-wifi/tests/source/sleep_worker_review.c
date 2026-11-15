/* Exercise the real asynchronous worker while stubbing firmware and address reads. */
#include <assert.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

typedef uint8_t t_u8;
typedef uint32_t t_u32;
typedef int mlan_status;
typedef unsigned int atomic_t;
enum { MLAN_STATUS_FAILURE = -1, MLAN_STATUS_SUCCESS, MLAN_STATUS_PENDING };
#define ACCESS_ONCE(x) (x)
#define SDIO_SUSPEND_RESUME 1
#define MLAN_BSS_TYPE_STA 0
#define HardwareStatusReady 1
#define KERN_WARNING ""
#define container_of(p, type, member) ((type *)((char *)(p) - offsetof(type, member)))
#define PRINTM(...) ((void)0)

struct notifier_block { int unused; };
struct work_struct { int unused; };
struct workqueue_struct { int unused; };
struct net_device { t_u32 address; t_u8 dev_addr[6]; };
typedef struct {
    int bss_type;
    bool media_connected;
    struct net_device *netdev;
} moal_private;
struct rp1_filter_state;
typedef struct {
    bool surprise_removed, driver_state, fw_reload, is_suspended, hs_activated;
    int hardware_status;
    unsigned int priv_num;
    moal_private *priv[2];
    struct rp1_filter_state *rp1_filter;
    int driver_lock;
} moal_handle;
#include "sleep_state.h"

static bool rp1_sleep_filter;
static atomic_t rp1_filter_generation;
static unsigned requests, warnings, queues;
static bool enabled[8];
static t_u8 addresses[8][4];
static t_u8 macs[8][6];
static mlan_status replies[8];
static moal_handle handle;
static moal_private priv;
static struct net_device netdev;
static struct rp1_filter_state state;

#define spin_lock_irqsave(lock, flags) do { (flags) = 0; assert(!*(lock)); *(lock) = 1; } while (0)
#define spin_unlock_irqrestore(lock, flags) do { (void)(flags); assert(*(lock)); *(lock) = 0; } while (0)
static void queue_work(struct workqueue_struct *queue, struct work_struct *work)
{
    assert(handle.driver_lock && queue == state.queue && work == &state.work);
    queues++;
}
static unsigned atomic_read(atomic_t *value) { return *value; }
static void printk(const char *format, ...) { (void)format; warnings++; }
static t_u32 rp1_filter_ipv4(struct net_device *device) { return device->address; }
static mlan_status rp1_filter_program(moal_private *device, const t_u8 ipv4[4], bool enable)
{
    assert(device == &priv && requests < 8 && !handle.driver_lock);
    enabled[requests] = enable;
    if (enable) {
        assert(ipv4);
        memcpy(addresses[requests], ipv4, 4);
        memcpy(macs[requests], device->netdev->dev_addr, 6);
    }
    return replies[requests++];
}
#include "sleep_priv.h"
#include "sleep_worker.h"
#include "sleep_event.h"

static void fresh(void)
{
    memset(&handle, 0, sizeof(handle));
    memset(&priv, 0, sizeof(priv));
    memset(&netdev, 0, sizeof(netdev));
    memset(&state, 0, sizeof(state));
    memset(enabled, 0, sizeof(enabled));
    memset(addresses, 0, sizeof(addresses));
    for (unsigned i = 0; i < 8; i++) replies[i] = MLAN_STATUS_SUCCESS;
    handle.hardware_status = HardwareStatusReady;
    handle.priv_num = 1;
    handle.priv[0] = &priv;
    priv.bss_type = MLAN_BSS_TYPE_STA;
    priv.media_connected = true;
    priv.netdev = &netdev;
    memcpy(&netdev.address, (t_u8[]){192, 168, 1, 135}, 4);
    memcpy(netdev.dev_addr, (t_u8[]){2, 0, 0, 0, 0, 4}, 6);
    state.handle = &handle;
    handle.rp1_filter = &state;
    rp1_sleep_filter = true;
    rp1_filter_generation = requests = warnings = queues = 0;
}

static void work(void) { rp1_filter_work(&state.work); }

int main(void)
{
    fresh(); work();
    assert(requests == 1 && enabled[0] && state.active && !state.failed);
    assert(!memcmp(addresses[0], (t_u8[]){192, 168, 1, 135}, 4));
    work(); assert(requests == 1);
    memcpy(&netdev.address, (t_u8[]){10, 21, 34, 56}, 4);
    work(); assert(requests == 2 && !memcmp(addresses[1], (t_u8[]){10, 21, 34, 56}, 4));
    rp1_sleep_filter = false;
    rp1_filter_generation++;
    work(); assert(requests == 3 && !enabled[2] && !state.active);
    work(); assert(requests == 3);
    rp1_sleep_filter = true;
    rp1_filter_generation++;
    work(); assert(requests == 4 && enabled[3] && state.active);
    priv.media_connected = false;
    work(); assert(requests == 5 && !enabled[4] && !state.active);
    puts("PASS actual worker reprograms dynamic IP, skips unchanged input and sends firmware disable for off/disconnect");

    const int failures[] = {MLAN_STATUS_FAILURE, MLAN_STATUS_PENDING};
    for (unsigned i = 0; i < sizeof(failures) / sizeof(failures[0]); i++) {
        fresh(); replies[0] = failures[i]; work();
        assert(requests == 2 && enabled[0] && !enabled[1] && state.failed && !state.active && warnings);
        assert(!state.dirty);
        work(); assert(requests == 2);
        rp1_filter_generation++;
        work(); assert(requests == 3 && enabled[2] && state.active && !state.failed);
    }
    fresh(); replies[0] = replies[1] = MLAN_STATUS_FAILURE; work();
    assert(requests == 2 && state.failed && state.dirty && warnings);
    work(); assert(requests == 2);
    rp1_sleep_filter = false;
    rp1_filter_generation++;
    work(); assert(requests == 3 && !enabled[2] && !state.dirty && !state.failed);
    puts("PASS actual worker attempts fail-open on failure/PENDING and latches failure until explicit retry");

    fresh(); state.stopping = true; work(); assert(!requests);
    fresh(); state.paused = true; work(); assert(!requests);
    fresh(); handle.surprise_removed = true; work(); assert(!requests);
    fresh(); handle.driver_state = true; work(); assert(!requests);
    fresh(); handle.fw_reload = true; work(); assert(!requests);
    fresh(); handle.hardware_status = 0; work(); assert(!requests);
    fresh(); handle.is_suspended = true; work(); assert(!requests);
    fresh(); handle.hs_activated = true; work(); assert(!requests);
    fresh(); netdev.address = 0; work(); assert(!requests);
    fresh(); priv.bss_type = 1; work(); assert(!requests);
    puts("PASS actual worker avoids firmware I/O while stopping, removed, reloading, suspended, offline or without STA/IP");
    fresh(); handle.is_suspended = true; work();
    assert(state.deferred && !requests);
    handle.is_suspended = false;
    woal_rp1_filter_event(&handle, false);
    assert(queues == 1 && !requests);
    work(); assert(requests == 1 && state.active && !state.deferred);
    woal_rp1_filter_event(&handle, false); assert(queues == 1);
    netdev.dev_addr[5] ^= 1;
    woal_rp1_filter_event(&handle, true); assert(queues == 2 && state.rebuild);
    work(); assert(requests == 2 && !state.rebuild);
    assert(!memcmp(macs[1], netdev.dev_addr, 6) && memcmp(macs[0], macs[1], 6));
    state.stopping = true;
    woal_rp1_filter_event(&handle, true); assert(queues == 2);
    state.stopping = false; handle.rp1_filter = NULL;
    woal_rp1_filter_event(&handle, true); assert(queues == 2);
    puts("PASS actual firmware-event callback only queues deferred/rebuild work and safely ignores unpublished state");
    return 0;
}
