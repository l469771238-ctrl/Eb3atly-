package com.eb3atly.recorder;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * Foreground service with the "microphone" type. While it runs, Android lets the
 * recorder keep capturing audio when the screen is off or the app is in the background.
 * The actual MediaRecorder lives in AudioRecorderPlugin; this service only keeps the
 * process alive and shows the ongoing-recording notification.
 */
public class AudioRecorderService extends Service {

    static final String CHANNEL_ID = "recording";
    static final int NOTIFICATION_ID = 4711;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        createChannel();
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "التسجيل", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("بيظهر وإحنا بنسجّل");
        channel.setShowBadge(false);
        nm.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        return b.setContentTitle("A.R صوتي بيسجّل")
            .setContentText("التسجيل شغال، افتح التطبيق عشان توقفه")
            .setSmallIcon(getApplicationInfo().icon != 0 ? getApplicationInfo().icon : android.R.drawable.ic_btn_speak_now)
            .setOngoing(true)
            .build();
    }
}
