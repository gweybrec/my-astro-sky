package com.gweybrec.myastrosky.app;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * The live plan's notifications (src/live-alerts-native.ts): `schedule` hands over every step of the night,
 * `clear` removes them. A button of the notification (Skip, +10 min, Stop) or a tap on it opens the app and fires
 * `action`, kept until the page listens (the app may have been killed).
 */
@CapacitorPlugin(
    name = "LivePlan",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class LivePlanPlugin extends Plugin {

    @Override
    public void load() {
        takeAction(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        takeAction(intent);
    }

    /** `{ status: {statusTitle, statusBody, actions}, steps: [...], labels: {...} }`, as the page builds it. */
    @PluginMethod
    public void schedule(PluginCall call) {
        LivePlanNotifier.start(getContext(), call.getData());
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        LivePlanNotifier.stop(getContext());
        call.resolve();
    }

    /** `{ granted }`: the notifications may show (asked once, on Android 13 and later). */
    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || getPermissionState("notifications") == PermissionState.GRANTED) {
            resolveGranted(call, true);
        } else {
            requestPermissionForAlias("notifications", call, "notificationsAnswered");
        }
    }

    @PermissionCallback
    private void notificationsAnswered(PluginCall call) {
        resolveGranted(call, getPermissionState("notifications") == PermissionState.GRANTED);
    }

    /** `{ granted }`: alarms may ring at the exact time ("Alarmes et rappels", off by default on Android 14). */
    @PluginMethod
    public void exactAlarms(PluginCall call) {
        resolveGranted(call, LivePlanNotifier.canScheduleExact(getContext()));
    }

    /** Opens Android's "Alarmes et rappels" page of the app. */
    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
                .setData(Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(intent);
        }
        call.resolve();
    }

    private static void resolveGranted(PluginCall call, boolean granted) {
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    private void takeAction(Intent intent) {
        if (intent == null || !intent.hasExtra(LivePlanNotifier.EXTRA_ACTION)) return;
        String action = intent.getStringExtra(LivePlanNotifier.EXTRA_ACTION);
        // Taken once: the same intent read again (the activity recreated) does nothing.
        intent.removeExtra(LivePlanNotifier.EXTRA_ACTION);
        JSObject data = new JSObject();
        data.put("action", action);
        notifyListeners("action", data, true);
    }
}
