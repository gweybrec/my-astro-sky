package com.gweybrec.myastrosky.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The live plan's notifications, shared by the plugin (the app running) and the receiver (the app killed, or the phone
 * restarted). The app hands over every step of the night at once: the visible notification's text from that moment on,
 * and the alert to vibrate with. An exact alarm wakes the receiver at each step, which updates the visible notification,
 * vibrates and sets the alarm of the next step. The steps are kept on the device, so a restart picks them up again.
 */
final class LivePlanNotifier {
    static final String EXTRA_ACTION = "livePlanAction";
    private static final String PREFS = "live_plan";
    private static final String KEY_PLAN = "plan";
    private static final String KEY_FIRED = "fired";
    private static final String CHANNEL_STATUS = "live_status";
    private static final String CHANNEL_ALERTS = "live_alerts";
    private static final int ID_STATUS = 4100;
    private static final int ID_ALERT = 4101;
    private static final int REQUEST_ALARM = 4100;
    private static final long[] VIBRATION = { 0, 400, 200, 400 };

    private LivePlanNotifier() {}

    /** Keeps the plan's steps and shows the visible notification now (`plan` as the plugin's `schedule` receives it). */
    static void start(Context context, JSONObject plan) {
        prefs(context).edit().putString(KEY_PLAN, plan.toString()).putLong(KEY_FIRED, System.currentTimeMillis()).apply();
        createChannels(context, plan);
        JSONObject status = plan.optJSONObject("status");
        if (status != null) postStatus(context, plan, status);
        armNext(context);
    }

    /** Removes the visible notification, the last alert and the next alarm. */
    static void stop(Context context) {
        cancelAlarm(context);
        NotificationManager nm = manager(context);
        nm.cancel(ID_STATUS);
        nm.cancel(ID_ALERT);
        prefs(context).edit().clear().apply();
    }

    /**
     * The alarm went off, or the phone restarted: the latest step that has come shows (its alert vibrates only when it
     * came since the last check, so a restart in the middle of the night does not vibrate again), then the next alarm.
     */
    static void wake(Context context, boolean alert) {
        JSONObject plan = load(context);
        if (plan == null) return;
        createChannels(context, plan);
        long now = System.currentTimeMillis();
        long fired = prefs(context).getLong(KEY_FIRED, 0);
        JSONArray steps = plan.optJSONArray("steps");
        JSONObject latest = null;
        for (int i = 0; steps != null && i < steps.length(); i++) {
            JSONObject step = steps.optJSONObject(i);
            if (step != null && step.optLong("atMs") <= now) latest = step;
        }
        if (latest != null) {
            postStatus(context, plan, latest);
            if (alert && latest.optLong("atMs") > fired && latest.has("alertTitle")) postAlert(context, latest);
        } else {
            JSONObject status = plan.optJSONObject("status");
            if (status != null) postStatus(context, plan, status);
        }
        prefs(context).edit().putLong(KEY_FIRED, now).apply();
        armNext(context);
    }

    static boolean canScheduleExact(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        return am != null && am.canScheduleExactAlarms();
    }

    private static void armNext(Context context) {
        cancelAlarm(context);
        JSONObject plan = load(context);
        if (plan == null) return;
        long now = System.currentTimeMillis();
        JSONArray steps = plan.optJSONArray("steps");
        long next = Long.MAX_VALUE;
        for (int i = 0; steps != null && i < steps.length(); i++) {
            JSONObject step = steps.optJSONObject(i);
            long at = step == null ? 0 : step.optLong("atMs");
            if (at > now && at < next) next = at;
        }
        if (next == Long.MAX_VALUE) return;
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = alarmIntent(context);
        // Without the "Alarmes et rappels" permission Android may deliver it a few minutes late (the app says so).
        if (canScheduleExact(context)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pi);
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pi);
    }

    private static void cancelAlarm(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(alarmIntent(context));
    }

    private static PendingIntent alarmIntent(Context context) {
        Intent intent = new Intent(context, LivePlanReceiver.class).setAction(LivePlanReceiver.ACTION_STEP);
        return PendingIntent.getBroadcast(context, REQUEST_ALARM, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** The visible notification: silent, kept while the plan runs; the last one ("Plan terminé") can be swiped away. */
    private static void postStatus(Context context, JSONObject plan, JSONObject step) {
        boolean finished = step.optBoolean("finished");
        NotificationCompat.Builder b = builder(context, CHANNEL_STATUS)
            .setContentTitle(step.optString("statusTitle"))
            .setContentText(step.optString("statusBody"))
            .setOngoing(!finished)
            .setAutoCancel(finished)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(openIntent(context, "open", 0));
        if (!finished) {
            JSONObject labels = plan.optJSONObject("labels");
            JSONArray actions = step.optJSONArray("actions");
            for (int i = 0; labels != null && actions != null && i < actions.length(); i++) {
                String action = actions.optString(i);
                b.addAction(0, labels.optString(action, action), openIntent(context, action, i + 1));
            }
        }
        manager(context).notify(ID_STATUS, b.build());
    }

    /** An alert: vibrates without sound (the channel's setting), replaces the previous one. */
    private static void postAlert(Context context, JSONObject step) {
        NotificationCompat.Builder b = builder(context, CHANNEL_ALERTS)
            .setContentTitle(step.optString("alertTitle"))
            .setContentText(step.optString("alertBody"))
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            // Before Android 8 there are no channels: the alert asks for its vibration itself.
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVibrate(VIBRATION)
            .setContentIntent(openIntent(context, "open", 0));
        manager(context).notify(ID_ALERT, b.build());
    }

    private static NotificationCompat.Builder builder(Context context, String channel) {
        return new NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_live_plan)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setShowWhen(true);
    }

    /** Opens the app; with a button's action the page applies it (Skip, +10 min, Stop). */
    private static PendingIntent openIntent(Context context, String action, int request) {
        Intent intent = new Intent(context, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .putExtra(EXTRA_ACTION, action)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, ID_STATUS + 10 + request, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void createChannels(Context context, JSONObject plan) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        JSONObject labels = plan.optJSONObject("labels");
        String statusName = labels == null ? "Live plan" : labels.optString("channelStatus", "Live plan");
        String alertsName = labels == null ? "Live plan alerts" : labels.optString("channelAlerts", "Live plan alerts");
        NotificationChannel status = new NotificationChannel(CHANNEL_STATUS, statusName, NotificationManager.IMPORTANCE_LOW);
        status.setSound(null, null);
        status.enableVibration(false);
        status.setShowBadge(false);
        NotificationChannel alerts = new NotificationChannel(CHANNEL_ALERTS, alertsName, NotificationManager.IMPORTANCE_HIGH);
        alerts.setSound(null, null);
        alerts.enableVibration(true);
        alerts.setVibrationPattern(VIBRATION);
        alerts.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        NotificationManager nm = manager(context);
        nm.createNotificationChannel(status);
        nm.createNotificationChannel(alerts);
    }

    private static JSONObject load(Context context) {
        String raw = prefs(context).getString(KEY_PLAN, null);
        if (raw == null) return null;
        try {
            return new JSONObject(raw);
        } catch (JSONException e) {
            return null;
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static NotificationManager manager(Context context) {
        return (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
    }
}
