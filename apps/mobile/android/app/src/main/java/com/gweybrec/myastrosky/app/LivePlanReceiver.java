package com.gweybrec.myastrosky.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Woken by the live plan's alarm at each step (the app may be killed), and after the phone restarts or the app is
 * updated (alarms do not survive either): `LivePlanNotifier` shows the step and sets the next alarm.
 */
public class LivePlanReceiver extends BroadcastReceiver {
    static final String ACTION_STEP = "com.gweybrec.myastrosky.app.LIVE_PLAN_STEP";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        // Only the alarm vibrates; a restart shows the current step again silently.
        LivePlanNotifier.wake(context, ACTION_STEP.equals(action));
    }
}
