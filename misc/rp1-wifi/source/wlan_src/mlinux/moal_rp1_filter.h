/* RP1 host-sleep filters. The firmware program is prepared while online, never
 * from suspend/resume. Failure leaves the original wake policy in control.
 * SPDX-License-Identifier: GPL-2.0
 */
#include <linux/inetdevice.h>

/* RP1_MEF_BUILDER_BEGIN */
/* Seven host-sleep-only entries, 356 bytes. First-match behavior and the
 * zero-mask discard were checked on the RP1 before using this whitelist.
 */
#define RP1_SLEEP_RULES 7
struct rp1_mef_match {
	t_u8 offset, length;
	t_u8 bytes[6];
};
struct rp1_mef_rule {
	t_u8 action, count;
	struct rp1_mef_match match[5];
};

/* Firmware offsets include LLC/SNAP (eight bytes beyond EN10MB). */
static const struct rp1_mef_rule rp1_sleep_rules[RP1_SLEEP_RULES - 1] = {
	/* Only ARP requests for this IPv4 receive the firmware's automatic reply. */
	{16, 3, {{20, 2, {8, 6}}, {28, 2, {0, 1}}, {46, 4, {0}}}},
	{3, 3, {{20, 2, {8, 6}}, {28, 2, {0, 2}}, {46, 4, {0}}}},
	/* Match the IP target, not just the MAC: APs may unicast multicast IPs. */
	{3, 2, {{20, 2, {8, 0}}, {38, 4, {0}}}},
	/* DHCP replies may be broadcast. Require this client's chaddr and keep
	 * fixed UDP/DHCP offsets confined to unfragmented IPv4 without options.
	 */
	{3, 5, {{20, 3, {8, 0, 0x45}}, {28, 2, {0, 0}}, {31, 1, {17}},
		{42, 4, {0, 67, 0, 68}}, {78, 6, {0}}}},
	{3, 5, {{20, 3, {8, 0, 0x45}}, {28, 2, {0x40, 0}}, {31, 1, {17}},
		{42, 4, {0, 67, 0, 68}}, {78, 6, {0}}}},
	{3, 1, {{20, 2, {0x88, 0x8e}}}},
};

/* A zero-mask BIT_EQ matches every remaining frame. Keep the exact tested
 * bytecode, including its mode-1/action-0 header, last in the entry stream.
 */
static const t_u8 rp1_sleep_discard[] = {
	1, 0, 12, 0, 0, 1, 2, 0, 0, 0, 0, 1, 0, 1, 2, 0x43
};

/* Return the complete entry stream, or -1 without touching a short buffer. */
static int
rp1_build_sleep_mef(t_u8 *out, t_size capacity, const t_u8 ipv4[4],
		    const t_u8 mac[6])
{
	const struct rp1_mef_rule *rule;
	t_size required = sizeof(rp1_sleep_discard), pos = 0;
	unsigned int r, m, i;

	if (!out || !ipv4 || !mac)
		return -1;
	for (r = 0; r < RP1_SLEEP_RULES - 1; r++) {
		rule = &rp1_sleep_rules[r];
		required += 4;
		for (m = 0; m < rule->count; m++)
			required += 13 + rule->match[m].length + !!m;
	}
	if (capacity < required)
		return -1;
	for (r = 0; r < RP1_SLEEP_RULES - 1; r++) {
		t_size header = pos, length;
		rule = &rp1_sleep_rules[r];
		out[pos++] = 1; /* host sleep only */
		out[pos++] = rule->action;
		pos += 2;
		for (m = 0; m < rule->count; m++) {
			const struct rp1_mef_match *match = &rule->match[m];
			const t_u8 *bytes = match->bytes;
			if ((r < 2 && m == 2) || (r == 2 && m == 1))
				bytes = ipv4;
			else if ((r == 3 || r == 4) && m == 4)
				bytes = mac;
			out[pos++] = 1; out[pos++] = 0; out[pos++] = 0; out[pos++] = 0;
			out[pos++] = 1; /* push repeat count */
			for (i = 0; i < match->length; i++)
				out[pos++] = bytes[i];
			out[pos++] = match->length; out[pos++] = 2; /* byte sequence */
			out[pos++] = match->offset;
			out[pos++] = 0; out[pos++] = 0; out[pos++] = 0;
			out[pos++] = 1; out[pos++] = 0x41; /* offset, byte match */
			if (m)
				out[pos++] = 0x44; /* AND */
		}
		length = pos - header - 4;
		out[header + 2] = length & 0xff;
		out[header + 3] = length >> 8;
	}
	memcpy(out + pos, rp1_sleep_discard, sizeof(rp1_sleep_discard));
	return pos + sizeof(rp1_sleep_discard);
}
/* RP1_MEF_BUILDER_END */

struct rp1_filter_state {
	moal_handle *handle;
	struct notifier_block inet_notifier;
	struct work_struct work;
	struct workqueue_struct *queue;
	unsigned int generation;
	t_u32 applied_ip;
	bool stopping, paused, deferred, rebuild, failed, active, dirty;
};

static bool rp1_sleep_filter = true;
static bool rp1_filter_module_ready;
static atomic_t rp1_filter_generation = ATOMIC_INIT(0);
static DEFINE_MUTEX(rp1_filter_lifecycle_lock);
/* Firmware wake reasons seen on resume: none, bcast, mcast, ucast, other. */
static unsigned int rp1_wakes[5];

void
rp1_count_wake(t_u16 reason)
{
	rp1_wakes[reason <= UCAST_DATA_MATCHED ? reason : 4]++;
}

/* An independent worker may wait with the existing bounded IOCTL helper. It
 * must not use the main workqueue that completes the same firmware command.
 */
static mlan_status
rp1_filter_program(moal_private *priv, const t_u8 ipv4[4], bool enable)
{
	mlan_ioctl_req *req;
	mlan_ds_misc_cfg *misc;
	mlan_ds_misc_cmd *cmd;
	mlan_status result;
	int length;

	req = woal_alloc_mlan_ioctl_req(sizeof(mlan_ds_misc_cfg));
	if (!req)
		return MLAN_STATUS_FAILURE;
	req->req_id = MLAN_IOCTL_MISC_CFG;
	req->action = MLAN_ACT_SET;
	misc = (mlan_ds_misc_cfg *)req->pbuf;
	misc->sub_command = MLAN_OID_MISC_MEF_CFG;
	misc->param.mef_cfg.sub_id = MEF_CFG_DISABLE;
	if (enable) {
		cmd = &misc->param.mef_cfg.param.cmd_buf;
		length = rp1_build_sleep_mef(cmd->cmd + 6,
					    sizeof(cmd->cmd) - 6, ipv4, priv->netdev->dev_addr);
		if (length < 0) {
			kfree(req);
			return MLAN_STATUS_FAILURE;
		}
		/* MEF_CFG_HOSTCMD copies criteria + count + entry stream verbatim. */
		cmd->cmd[0] = 11;
		cmd->cmd[1] = cmd->cmd[2] = cmd->cmd[3] = 0;
		cmd->cmd[4] = RP1_SLEEP_RULES;
		cmd->cmd[5] = 0;
		cmd->len = length + 6;
		misc->param.mef_cfg.sub_id = MEF_CFG_HOSTCMD;
	}
	result = woal_request_ioctl(priv, req, MOAL_IOCTL_WAIT_TIMEOUT);
	/* PENDING transfers ownership, including a timed-out detached request. */
	if (result != MLAN_STATUS_PENDING)
		kfree(req);
	return result;
}

static moal_private *
rp1_filter_priv(moal_handle *handle)
{
	unsigned int i;
	for (i = 0; i < handle->priv_num; i++)
		if (handle->priv[i] &&
		    handle->priv[i]->bss_type == MLAN_BSS_TYPE_STA)
			return handle->priv[i];
	return NULL;
}

static t_u32
rp1_filter_ipv4(struct net_device *dev)
{
	struct in_device *in_dev;
	struct in_ifaddr *ifa;
	t_u32 address = 0;

	rcu_read_lock();
	in_dev = __in_dev_get_rcu(dev);
	if (in_dev)
		for (ifa = rcu_dereference(in_dev->ifa_list); ifa;
		     ifa = rcu_dereference(ifa->ifa_next)) {
			if (!(ifa->ifa_flags & IFA_F_SECONDARY)) {
				address = ifa->ifa_local;
				break;
			}
		}
	rcu_read_unlock();
	return address;
}

static void
rp1_filter_work(struct work_struct *work)
{
	struct rp1_filter_state *state =
		container_of(work, struct rp1_filter_state, work);
	moal_handle *handle = state->handle;
	moal_private *priv;
	t_u32 address;
	unsigned int generation = atomic_read(&rp1_filter_generation);
	unsigned long flags;
	bool enable, force;
	mlan_status result, fallback;

	if (state->stopping || state->paused || handle->surprise_removed || handle->driver_state ||
	    handle->fw_reload || handle->hardware_status != HardwareStatusReady)
		return;
	spin_lock_irqsave(&handle->driver_lock, flags);
#ifdef SDIO_SUSPEND_RESUME
	if (handle->is_suspended || handle->hs_activated) {
		state->deferred = true;
		spin_unlock_irqrestore(&handle->driver_lock, flags);
		return;
	}
#endif
	state->deferred = false;
	force = state->rebuild;
	state->rebuild = false;
	spin_unlock_irqrestore(&handle->driver_lock, flags);
	priv = rp1_filter_priv(handle);
	if (!priv)
		return;
	if (state->generation != generation) {
		state->generation = generation;
		state->failed = false; /* only explicit parameter writes allow retry */
		force = true;
	}
	if (state->failed)
		return;
	address = rp1_filter_ipv4(priv->netdev);
	enable = ACCESS_ONCE(rp1_sleep_filter) && address &&
		priv->media_connected;
	if (enable && !force && state->active && state->applied_ip == address)
		return;
	if (!enable && !state->dirty)
		return;
	if (enable)
		state->dirty = true; /* failure may still have reached firmware */
	result = rp1_filter_program(priv, (const t_u8 *)&address, enable);
	if (result == MLAN_STATUS_SUCCESS) {
		state->active = enable;
		state->dirty = enable;
		state->applied_ip = enable ? address : 0;
		PRINTM(MMSG, "RP1 sleep filter: active=%u ip=%pI4\n",
		       enable, &state->applied_ip);
		return;
	}
	/* Fail open, once per explicit attempt. Never loop on a sick firmware. */
	state->failed = true;
	state->active = false;
	state->applied_ip = 0;
	fallback = result;
	if (enable && !state->stopping && !handle->surprise_removed)
		fallback = rp1_filter_program(priv, NULL, false);
	state->dirty = fallback != MLAN_STATUS_SUCCESS;
	printk(KERN_WARNING "rp1_sleep_filter: programming failed; optimization disabled until toggled, fallback=%d\n",
	       fallback);
}

/* Firmware events only queue pending configuration. No commands or waits are
 * added to host-sleep recovery. The short lock protects teardown publication.
 */
void
woal_rp1_filter_event(moal_handle *handle, bool rebuild)
{
	struct rp1_filter_state *state;
	unsigned long flags;
	spin_lock_irqsave(&handle->driver_lock, flags);
	state = handle->rp1_filter;
	if (state && !state->stopping && !state->paused &&
	    (rebuild || state->deferred)) {
		if (rebuild)
			state->rebuild = true;
		queue_work(state->queue, &state->work);
	}
	spin_unlock_irqrestore(&handle->driver_lock, flags);
}

static int
rp1_filter_inet_event(struct notifier_block *notifier,
		      unsigned long event, void *data)
{
	struct rp1_filter_state *state =
		container_of(notifier, struct rp1_filter_state, inet_notifier);
	struct in_ifaddr *ifa = data;
	moal_private *priv;

	if (ACCESS_ONCE(state->stopping) || ACCESS_ONCE(state->paused))
		return NOTIFY_DONE;
	priv = rp1_filter_priv(state->handle);
	if (priv && ifa->ifa_dev->dev == priv->netdev &&
	    (event == NETDEV_UP || event == NETDEV_DOWN))
		queue_work(state->queue, &state->work);
	return NOTIFY_DONE;
}

/* Called before interfaces can disappear. */
static void
rp1_filter_stop(moal_handle *handle)
{
	struct rp1_filter_state *state;
	unsigned long flags;
	mutex_lock(&rp1_filter_lifecycle_lock);
	state = handle->rp1_filter;
	if (!state)
		goto done; /* Early probe failure may predate driver_lock init. */
	spin_lock_irqsave(&handle->driver_lock, flags);
	handle->rp1_filter = NULL;
	state->stopping = true;
	spin_unlock_irqrestore(&handle->driver_lock, flags);
	unregister_inetaddr_notifier(&state->inet_notifier);
	cancel_work_sync(&state->work);
	destroy_workqueue(state->queue);
	kfree(state);
done:
	mutex_unlock(&rp1_filter_lifecycle_lock);
}

/* An in-place firmware reload keeps the same interfaces and IPv4. Pause the
 * worker first; its successful completion will force a new program afterward.
 */
static void
rp1_filter_pause(moal_handle *handle)
{
	struct rp1_filter_state *state;
	unsigned long flags;
	mutex_lock(&rp1_filter_lifecycle_lock);
	spin_lock_irqsave(&handle->driver_lock, flags);
	state = handle->rp1_filter;
	if (state)
		state->paused = true;
	spin_unlock_irqrestore(&handle->driver_lock, flags);
	if (state)
		cancel_work_sync(&state->work);
	mutex_unlock(&rp1_filter_lifecycle_lock);
}

static void
rp1_filter_start(moal_handle *handle)
{
	struct rp1_filter_state *state;
	unsigned long flags;
	if (handle->card_type != CARD_TYPE_SD8897)
		return;
	mutex_lock(&rp1_filter_lifecycle_lock);
	state = handle->rp1_filter;
	if (state) {
		/* Only the paused in-place reload retains an existing state. */
		if (!state->paused)
			goto done;
		state->active = state->dirty = state->failed = false;
		spin_lock_irqsave(&handle->driver_lock, flags);
		state->paused = false;
		state->rebuild = true;
		spin_unlock_irqrestore(&handle->driver_lock, flags);
		queue_work(state->queue, &state->work);
		goto done;
	}
	state = kzalloc(sizeof(*state), GFP_KERNEL);
	if (!state)
		goto failed;
	state->handle = handle;
	state->generation = atomic_read(&rp1_filter_generation);
	INIT_WORK(&state->work, rp1_filter_work);
	state->queue = alloc_workqueue("rp1_sleep_filter", WQ_FREEZABLE | WQ_UNBOUND, 1);
	if (!state->queue)
		goto free_state;
	state->inet_notifier.notifier_call = rp1_filter_inet_event;
	if (register_inetaddr_notifier(&state->inet_notifier)) {
		destroy_workqueue(state->queue);
		goto free_state;
	}
	spin_lock_irqsave(&handle->driver_lock, flags);
	handle->rp1_filter = state;
	spin_unlock_irqrestore(&handle->driver_lock, flags);
	queue_work(state->queue, &state->work);
	goto done;
free_state:
	kfree(state);
failed:
	printk(KERN_WARNING "rp1_sleep_filter: unavailable; original wake policy retained\n");
done:
	mutex_unlock(&rp1_filter_lifecycle_lock);
}

/* Caller holds AddRemoveCardSem. A new generation forces reprogramming and
 * clears a failure latch: explicit writes are the only retry path.
 */
static void
rp1_filter_requeue(void)
{
	int i;
	mutex_lock(&rp1_filter_lifecycle_lock);
	atomic_inc(&rp1_filter_generation);
	for (i = 0; i < MAX_MLAN_ADAPTER; i++)
		if (m_handle[i] && m_handle[i]->rp1_filter)
			queue_work(m_handle[i]->rp1_filter->queue,
				   &m_handle[i]->rp1_filter->work);
	mutex_unlock(&rp1_filter_lifecycle_lock);
}

static int
rp1_filter_set(const char *value, const struct kernel_param *param)
{
	int result;
	if (!rp1_filter_module_ready)
		return param_set_bool(value, param);
	if (down_interruptible(&AddRemoveCardSem))
		return -EINTR;
	result = param_set_bool(value, param);
	if (result) {
		up(&AddRemoveCardSem);
		return result;
	}
	rp1_filter_requeue();
	up(&AddRemoveCardSem);
	return 0;
}

static int
rp1_filter_get_state(char *buffer, const struct kernel_param *param)
{
	int i, length = 0;
	if (!rp1_filter_module_ready)
		return scnprintf(buffer, PAGE_SIZE, "unavailable\n");
	if (down_interruptible(&AddRemoveCardSem))
		return -EINTR;
	mutex_lock(&rp1_filter_lifecycle_lock);
	for (i = 0; i < MAX_MLAN_ADAPTER; i++) {
		struct rp1_filter_state *state;
		t_u32 address;
		if (!m_handle[i] || !(state = m_handle[i]->rp1_filter))
			continue;
		address = ACCESS_ONCE(state->applied_ip);
		length += scnprintf(buffer + length, PAGE_SIZE - length,
			"adapter=%d active=%u failed=%u dirty=%u paused=%u ip=%pI4\n", i,
			ACCESS_ONCE(state->active), ACCESS_ONCE(state->failed),
			ACCESS_ONCE(state->dirty), ACCESS_ONCE(state->paused), &address);
	}
	mutex_unlock(&rp1_filter_lifecycle_lock);
	up(&AddRemoveCardSem);
	if (!length)
		length = scnprintf(buffer, PAGE_SIZE, "unavailable\n");
	return length + scnprintf(buffer + length, PAGE_SIZE - length,
		"wakes none=%u bcast=%u mcast=%u ucast=%u other=%u\n",
		ACCESS_ONCE(rp1_wakes[0]), ACCESS_ONCE(rp1_wakes[1]), ACCESS_ONCE(rp1_wakes[2]),
		ACCESS_ONCE(rp1_wakes[3]), ACCESS_ONCE(rp1_wakes[4]));
}

static const struct kernel_param_ops rp1_filter_ops = {
	.set = rp1_filter_set, .get = param_get_bool,
};
static const struct kernel_param_ops rp1_filter_state_ops = {
	.get = rp1_filter_get_state,
};
module_param_cb(rp1_sleep_filter, &rp1_filter_ops, &rp1_sleep_filter, 0644);
MODULE_PARM_DESC(rp1_sleep_filter, "RP1 host-sleep local-IPv4 whitelist (independent of resume fixes)");
module_param_cb(rp1_sleep_filter_state, &rp1_filter_state_ops, NULL, 0444);
