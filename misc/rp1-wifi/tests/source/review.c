/* Deterministic interleavings exercise the extracted driver bodies under ASan. */
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <string.h>
#include <errno.h>
#define IN
#define ENTER() ((void)0)
#define LEAVE() ((void)0)
#define MTRUE 1
#define MFALSE 0
#define MAX_RETRY_CNT 100
#define HZ 100
#define MOAL_IOCTL_TIMEOUT (20 * HZ)
#define ERESTARTSYS 512
#define KERNEL_VERSION(a,b,c) (((a)<<16)|((b)<<8)|(c))
#define CFG80211_VERSION_CODE KERNEL_VERSION(3,14,35)
#define CONFIG_PM 1
#define MIN(a,b) ((a)<(b)?(a):(b))
#define MLAN_MAX_BSS_NUM 16
#define MLAN_BSS_ROLE_STA 0
#define GET_BSS_ROLE(p) ((p)->role)
#define EVENT_BG_SCAN_REPORT 4
#define GFP_KERNEL 0
#define KERN_INFO ""
#define MMSG 1
#define MERROR 4
#define MIOCTL 128
#define MCMND 16
#define MLAN_IOCTL_PM_CFG 0x90000
#define MLAN_OID_PM_HS_WAKEUP_REASON 0x9000b
#define MLAN_ACT_GET 2
#define MLAN_ERROR_CMD_TIMEOUT 0x80000005U
#define MLAN_ERROR_CMD_CANCEL 0x80000006U
#define NO_HSWAKEUP_REASON 0
#define BCAST_DATA_MATCHED 1
#define MCAST_DATA_MATCHED 2
#define UCAST_DATA_MATCHED 3
#define MASKTABLE_EVENT_MATCHED 4
#define NON_MASKABLE_EVENT_MATCHED 5
#define NON_MASKABLE_CONDITION_MATCHED 6
#define MAGIC_PATTERN_MATCHED 7
#define CONTROL_FRAME_MATCHED 8
#define MANAGEMENT_FRAME_MATCHED 9
#define GTK_REKEY_FAILURE 10
#define ACCESS_ONCE(x) (*(volatile __typeof__(x) *)&(x))
typedef uint32_t t_u32;
typedef uint8_t t_u8;
typedef uintptr_t t_ptr;
typedef void t_void;
typedef int mlan_status;
enum { MLAN_STATUS_FAILURE=-1, MLAN_STATUS_SUCCESS=0, MLAN_STATUS_PENDING=1, MLAN_STATUS_RESOURCE=2, MLAN_STATUS_COMPLETE=3 };
enum { MOAL_NO_WAIT, MOAL_IOCTL_WAIT, MOAL_IOCTL_WAIT_TIMEOUT };
typedef struct { int held; } review_lock_t;
typedef struct { unsigned wakes; } wait_queue_head_t;
typedef struct { wait_queue_head_t wait; bool condition; long start_time; mlan_status status; t_u8 wait_timeout, retry; } wait_queue;
typedef struct { uint16_t hs_wakeup_reason; } mlan_ds_hs_wakeup_reason;
typedef struct { t_u32 sub_command; union { mlan_ds_hs_wakeup_reason wakeup_reason; } param; } mlan_ds_pm_cfg;
typedef struct { t_u32 req_id,status_code,action; t_u8 bss_index; void *pbuf; t_ptr reserved_1; } mlan_ioctl_req, *pmlan_ioctl_req;
struct cfg80211_wowlan { bool disconnect,magic_pkt,gtk_rekey_failure; int n_patterns; };
struct wiphy { void *priv; struct cfg80211_wowlan *wowlan_config; };
struct cfg80211_wowlan_wakeup { bool disconnect,magic_pkt,gtk_rekey_failure; int pattern_idx; };
struct wireless_dev { struct wiphy *wiphy; };
typedef struct moal_private moal_private;
typedef struct moal_handle { review_lock_t driver_lock; int ioctl_pending; bool ioctl_timeout,cfg80211_suspend; int priv_num; moal_private *priv[MLAN_MAX_BSS_NUM]; struct { wait_queue_head_t wait_q; } reassoc_thread; } moal_handle;
struct moal_private { moal_handle *phandle; struct wireless_dev *wdev; int role; t_u32 last_event; bool sched_scanning,roaming_enabled,roaming_required; };
static bool diagnostic, hw_test;
static unsigned long jiffies;
static unsigned diagnostic_logs,factory_logs,wake_all,wake_interruptible,alloc_count,free_count,report_count,processed_response;
static moal_handle handle;
static moal_private priv;
static struct wiphy phy;
static struct wireless_dev wdev;
static struct cfg80211_wowlan wowlan;
static mlan_ioctl_req *active_req;
static int request_status=10, completion_status;
static uint16_t response_reason;
static bool alloc_fail;
static char diagnostic_text[16384];
enum mode { COMPLETE_IN_WAIT, TIMEOUT_ONLY, COMPLETE_AFTER_TIMER, TIMEOUT_LATE_ON_UNLOCK };
static enum mode mode;
enum unlock_action { NO_ACTION, LATE_COMPLETION, OWNER_FREE };
static enum unlock_action unlock_action;
static void *live_allocations[128];
static unsigned live_count;
static void printk(const char *fmt,...) { va_list ap; va_start(ap,fmt); size_t n=strlen(diagnostic_text); vsnprintf(diagnostic_text+n,sizeof(diagnostic_text)-n,fmt,ap); va_end(ap); diagnostic_logs++; }
static void factory_log(const char *fmt,...) { (void)fmt; factory_logs++; }
#define PRINTM(level,...) factory_log(__VA_ARGS__)
#include "generated/diagnostic_macro.h"
static int atomic_read(int *v) { return *v; }
static void atomic_dec(int *v) { --*v; }
static void init_waitqueue_head(wait_queue_head_t *q) { q->wakes=0; }
static unsigned long jiffies_to_msecs(unsigned long v) { return v*1000/HZ; }
static void kfree(void *p) { if(!p)return; unsigned i; for(i=0;i<live_count && live_allocations[i]!=p;i++) {} assert(i<live_count); live_allocations[i]=live_allocations[--live_count]; free_count++; free(p); }
static mlan_ioctl_req *woal_alloc_mlan_ioctl_req(int size) { if(alloc_fail)return NULL; size_t n=sizeof(mlan_ioctl_req)+sizeof(wait_queue)+(size_t)size+sizeof(int); mlan_ioctl_req *r=calloc(1,n); assert(r && live_count<128); live_allocations[live_count++]=r; alloc_count++; r->reserved_1=(uintptr_t)(r+1); r->pbuf=(char *)(r+1)+sizeof(wait_queue); active_req=r; return r; }
static moal_private *woal_bss_index_to_priv(moal_handle *h,t_u8 b) { return b<h->priv_num?h->priv[b]:NULL; }
static void woal_process_ioctl_resp(moal_private *p,mlan_ioctl_req *r) { assert(p && r); processed_response++; }
static void review_lock(review_lock_t *l) { assert(!l->held); l->held=1; }
static void review_unlock(review_lock_t *l);
#define spin_lock_irqsave(l,f) do { (f)=0; review_lock(l); } while(0)
#define spin_unlock_irqrestore(l,f) do { (void)(f); review_unlock(l); } while(0)
static void wake_up(wait_queue_head_t *q) { assert(handle.driver_lock.held); q->wakes++; wake_all++; }
static void wake_up_interruptible(wait_queue_head_t *q) { if(q==&handle.reassoc_thread.wait_q)return; assert(handle.driver_lock.held); q->wakes++; wake_interruptible++; }
static long review_wait(wait_queue_head_t *,bool *,bool);
#define wait_event_interruptible_exclusive(q,c) review_wait(&(q),&(c),false)
#define wait_event_timeout(q,c,t) ((void)(t),review_wait(&(q),&(c),true))
static mlan_status woal_request_ioctl(moal_private *,mlan_ioctl_req *,t_u8);
#include "generated/woal_fill_wait_queue.h"
#include "generated/woal_wait_ioctl_complete.h"
#include "generated/moal_ioctl_complete.h"
static void review_unlock(review_lock_t *l) {
 assert(l->held); l->held=0;
 enum unlock_action a=unlock_action; unlock_action=NO_ACTION;
 if(a==LATE_COMPLETION) { assert(active_req->reserved_1==0); moal_ioctl_complete(&handle,active_req,completion_status); active_req=NULL; }
 if(a==OWNER_FREE) { assert(active_req && ((wait_queue *)active_req->reserved_1)->condition); kfree(active_req); active_req=NULL; }
}
static long review_wait(wait_queue_head_t *q,bool *condition,bool timed) {
 assert(!handle.driver_lock.held);
 if(*condition)return 1;
 if(mode==COMPLETE_IN_WAIT || mode==COMPLETE_AFTER_TIMER) {
  if(mode==COMPLETE_AFTER_TIMER) { assert(timed); jiffies+=MOAL_IOCTL_TIMEOUT; }
  mlan_ds_pm_cfg *cfg=active_req->pbuf; cfg->param.wakeup_reason.hs_wakeup_reason=response_reason;
  unsigned previous=q->wakes;
  moal_ioctl_complete(&handle,active_req,completion_status);
  assert(*condition && q->wakes==previous+1); /* Fails for stock CMD_TIMEOUT missing wake. */
  return mode==COMPLETE_AFTER_TIMER?0:1;
 }
 assert(timed); jiffies+=MOAL_IOCTL_TIMEOUT;
 if(mode==TIMEOUT_LATE_ON_UNLOCK)unlock_action=LATE_COMPLETION;
 return 0;
}
static mlan_status woal_request_ioctl(moal_private *p,mlan_ioctl_req *r,t_u8 opt) {
 assert(opt==MOAL_IOCTL_WAIT_TIMEOUT); /* Actual getter must retain bounded wait. */
 if(request_status!=10)return request_status;
 handle.ioctl_pending++;
 woal_fill_wait_queue(p,(wait_queue *)r->reserved_1,opt);
 return woal_wait_ioctl_complete(p,r,opt);
}
#include "generated/woal_get_wakeup_reason.h"
static mlan_status woal_get_wakeup_reason(moal_private *p,mlan_ds_hs_wakeup_reason *reason) { assert(reason->hs_wakeup_reason==0); return review_real_get_wakeup_reason(p,reason); }
static void *woal_get_wiphy_priv(struct wiphy *p) { return p->priv; }
static moal_private *woal_get_priv(moal_handle *h,int role) { return h->priv_num && h->priv[0]->role==role?h->priv[0]:NULL; }
static void woal_inform_bss_from_scan_result(moal_private *p,void *unused,int opt) { (void)p;(void)unused;(void)opt; }
static void cfg80211_sched_scan_results(struct wiphy *p) { (void)p; }
static void cfg80211_report_wowlan_wakeup(struct wireless_dev *d,struct cfg80211_wowlan_wakeup *r,int gfp) { assert(d && r); (void)gfp; report_count++; }
#include "generated/woal_cfg80211_resume.h"
static void fresh(void) {
 assert(live_count==0); memset(&handle,0,sizeof(handle)); memset(&priv,0,sizeof(priv)); memset(&phy,0,sizeof(phy)); memset(&wdev,0,sizeof(wdev)); memset(&wowlan,0,sizeof(wowlan));
 handle.priv_num=1; handle.priv[0]=&priv; handle.cfg80211_suspend=true; priv.phandle=&handle; priv.wdev=&wdev; wdev.wiphy=&phy; phy.priv=&handle; phy.wowlan_config=&wowlan;
 diagnostic=false; diagnostic_text[0]=0; diagnostic_logs=factory_logs=wake_all=wake_interruptible=alloc_count=free_count=report_count=processed_response=0; jiffies=123; active_req=NULL; request_status=10; completion_status=MLAN_STATUS_SUCCESS; response_reason=UCAST_DATA_MATCHED; mode=COMPLETE_IN_WAIT; unlock_action=NO_ACTION; alloc_fail=false;
}
static mlan_ioctl_req *new_waiter(t_u8 option) { mlan_ioctl_req *r=woal_alloc_mlan_ioctl_req(sizeof(mlan_ds_pm_cfg)); r->req_id=MLAN_IOCTL_PM_CFG; ((mlan_ds_pm_cfg *)r->pbuf)->sub_command=MLAN_OID_PM_HS_WAKEUP_REASON; r->action=MLAN_ACT_GET; handle.ioctl_pending=1; woal_fill_wait_queue(&priv,(wait_queue *)r->reserved_1,option); return r; }
int main(void) {
 fresh(); diagnostic=true; mlan_ioctl_req *r=new_waiter(MOAL_IOCTL_WAIT); r->status_code=MLAN_ERROR_CMD_TIMEOUT; completion_status=MLAN_STATUS_FAILURE;
 assert(woal_wait_ioctl_complete(&priv,r,MOAL_IOCTL_WAIT)==MLAN_STATUS_FAILURE); assert(wake_interruptible==1 && wake_all==0); kfree(r); assert(free_count==1); puts("PASS ordinary WAIT/CMD_TIMEOUT actually wakes and returns failure");
 fresh(); diagnostic=true; r=new_waiter(MOAL_IOCTL_WAIT_TIMEOUT); mode=TIMEOUT_ONLY;
 assert(woal_wait_ioctl_complete(&priv,r,MOAL_IOCTL_WAIT_TIMEOUT)==MLAN_STATUS_PENDING); assert(r->reserved_1==0 && free_count==0); moal_ioctl_complete(&handle,r,MLAN_STATUS_SUCCESS); active_req=NULL; assert(free_count==1 && processed_response==1); puts("PASS timeout transfers ownership; late completion frees exactly once");
 fresh(); diagnostic=true; mode=TIMEOUT_LATE_ON_UNLOCK; mlan_ds_hs_wakeup_reason result={0};
 assert(review_real_get_wakeup_reason(&priv,&result)==MLAN_STATUS_PENDING); assert(free_count==1 && live_count==0); assert(strstr(diagnostic_text,"detached=1")); puts("PASS timeout-wins race frees req/wait/pbuf before WAIT_DONE and query logs (ASan)");
 fresh(); diagnostic=true; mode=COMPLETE_AFTER_TIMER; result.hs_wakeup_reason=0;
 assert(review_real_get_wakeup_reason(&priv,&result)==MLAN_STATUS_SUCCESS); assert(result.hs_wakeup_reason==UCAST_DATA_MATCHED && free_count==1 && wake_all==1); puts("PASS completion-wins boundary observes completed under lock; owner frees once");
 fresh(); diagnostic=true; r=new_waiter(MOAL_IOCTL_WAIT); unlock_action=OWNER_FREE;
 assert(moal_ioctl_complete(&handle,r,MLAN_STATUS_SUCCESS)==MLAN_STATUS_SUCCESS); assert(free_count==1 && live_count==0 && strstr(diagnostic_text,"attached=1")); puts("PASS owner frees immediately after completion unlock, before completion log (ASan)");
 int failures[]={MLAN_STATUS_FAILURE,MLAN_STATUS_RESOURCE};
 for(unsigned i=0;i<sizeof(failures)/sizeof(*failures);i++) { fresh(); request_status=failures[i]; assert(woal_cfg80211_resume(&phy)==0); assert(!handle.cfg80211_suspend && report_count==0 && free_count==1); assert(diagnostic_logs==0); }
 fresh(); alloc_fail=true; assert(woal_cfg80211_resume(&phy)==0); assert(!handle.cfg80211_suspend && report_count==0 && alloc_count==0); puts("PASS resume immediate failures/ENOMEM clear suspended and do not report");
 fresh(); mode=TIMEOUT_ONLY; assert(woal_cfg80211_resume(&phy)==0); assert(!handle.cfg80211_suspend && report_count==0 && free_count==0); moal_ioctl_complete(&handle,active_req,MLAN_STATUS_FAILURE); active_req=NULL; assert(free_count==1); puts("PASS resume PENDING timeout clears suspended without report or premature free");
 fresh(); handle.priv_num=0; assert(woal_cfg80211_resume(&phy)==0); assert(!handle.cfg80211_suspend && alloc_count==0 && report_count==0); puts("PASS missing STA leaves suspend state clean");
 fresh(); assert(woal_cfg80211_resume(&phy)==0); assert(!handle.cfg80211_suspend && report_count==1 && free_count==1 && diagnostic_logs==0); assert(factory_logs>0); puts("PASS successful resume still reports; diagnostic off emits no custom logs");
 fresh(); diagnostic=true; assert(woal_cfg80211_resume(&phy)==0); assert(diagnostic_logs>0 && strstr(diagnostic_text,"WAKE_QUERY_BEGIN") && strstr(diagnostic_text,"RESUME_DONE")); puts("PASS diagnostic on emits the actual macro's query/wait/completion markers");
 assert(live_count==0); puts("All extracted-source checks passed (host simulation, not kernel/device validation)."); return 0;
}
