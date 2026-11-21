package com.eb3atly.recorder;

import android.Manifest;
import android.content.Intent;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.SystemClock;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;

/**
 * Native AAC (m4a) recorder with pause/resume that keeps working in the background.
 * JS API: start, pause, resume, stop, status, plus checkPermissions / requestPermissions.
 */
@CapacitorPlugin(
    name = "AudioRecorder",
    permissions = { @Permission(alias = AudioRecorderPlugin.MIC, strings = { Manifest.permission.RECORD_AUDIO }) }
)
public class AudioRecorderPlugin extends Plugin {

    static final String MIC = "microphone";

    private MediaRecorder recorder;
    private File currentFile;
    private long accumulatedMs = 0;   // time recorded before the last pause
    private long segmentStartMs = 0;  // when the current (unpaused) segment started
    private boolean paused = false;

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState(MIC) != PermissionState.GRANTED) {
            requestPermissionForAlias(MIC, call, "startAfterPermission");
            return;
        }
        startInternal(call);
    }

    @PermissionCallback
    private void startAfterPermission(PluginCall call) {
        if (getPermissionState(MIC) != PermissionState.GRANTED) {
            call.reject("Microphone permission was not granted", "MISSING_PERMISSION");
            return;
        }
        startInternal(call);
    }

    private void startInternal(PluginCall call) {
        if (recorder != null) {
            call.reject("A recording is already in progress", "ALREADY_RECORDING");
            return;
        }
        try {
            File dir = new File(getContext().getCacheDir(), "rec-tmp");
            if (!dir.exists() && !dir.mkdirs()) {
                call.reject("Could not create the recording folder", "FAILED_TO_RECORD");
                return;
            }
            File file = new File(dir, "rec_" + System.currentTimeMillis() + ".m4a");

            MediaRecorder mr = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                ? new MediaRecorder(getContext())
                : new MediaRecorder();
            mr.setAudioSource(MediaRecorder.AudioSource.MIC);
            mr.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            mr.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            mr.setAudioEncodingBitRate(128000);
            mr.setAudioSamplingRate(44100);
            mr.setAudioChannels(1);
            mr.setOutputFile(file.getAbsolutePath());
            mr.prepare();

            // The foreground service must be running before the mic is opened in the background.
            ContextCompat.startForegroundService(getContext(), new Intent(getContext(), AudioRecorderService.class));
            mr.start();

            recorder = mr;
            currentFile = file;
            accumulatedMs = 0;
            segmentStartMs = SystemClock.elapsedRealtime();
            paused = false;

            JSObject out = new JSObject();
            out.put("value", true);
            call.resolve(out);
        } catch (Exception e) {
            releaseRecorder();
            stopService();
            call.reject("Could not start recording: " + e.getMessage(), "FAILED_TO_RECORD");
        }
    }

    @PluginMethod
    public void pause(PluginCall call) {
        if (recorder == null) {
            call.reject("No recording in progress", "RECORDING_HAS_NOT_STARTED");
            return;
        }
        if (paused) {
            resolveValue(call, false);
            return;
        }
        try {
            recorder.pause();
            accumulatedMs += SystemClock.elapsedRealtime() - segmentStartMs;
            paused = true;
            resolveValue(call, true);
        } catch (Exception e) {
            call.reject("Pause failed: " + e.getMessage(), "NOT_SUPPORTED_OS_VERSION");
        }
    }

    @PluginMethod
    public void resume(PluginCall call) {
        if (recorder == null) {
            call.reject("No recording in progress", "RECORDING_HAS_NOT_STARTED");
            return;
        }
        if (!paused) {
            resolveValue(call, false);
            return;
        }
        try {
            recorder.resume();
            segmentStartMs = SystemClock.elapsedRealtime();
            paused = false;
            resolveValue(call, true);
        } catch (Exception e) {
            call.reject("Resume failed: " + e.getMessage(), "NOT_SUPPORTED_OS_VERSION");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (recorder == null || currentFile == null) {
            call.reject("No recording in progress", "RECORDING_HAS_NOT_STARTED");
            return;
        }
        long total = accumulatedMs + (paused ? 0 : SystemClock.elapsedRealtime() - segmentStartMs);
        File file = currentFile;
        boolean ok = true;
        try {
            recorder.stop();
        } catch (RuntimeException e) {
            // stop() throws when nothing was captured (very short recording)
            ok = false;
        }
        releaseRecorder();
        stopService();

        if (!ok || !file.exists() || file.length() == 0) {
            file.delete();
            call.reject("Recording stopped too early", "EMPTY_RECORDING");
            return;
        }
        JSObject value = new JSObject();
        value.put("path", file.getAbsolutePath());
        value.put("msDuration", total);
        value.put("mimeType", "audio/mp4");
        JSObject out = new JSObject();
        out.put("value", value);
        call.resolve(out);
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject out = new JSObject();
        out.put("status", recorder == null ? "NONE" : (paused ? "PAUSED" : "RECORDING"));
        call.resolve(out);
    }

    private void resolveValue(PluginCall call, boolean value) {
        JSObject out = new JSObject();
        out.put("value", value);
        call.resolve(out);
    }

    private void releaseRecorder() {
        if (recorder != null) {
            try { recorder.release(); } catch (Exception ignored) { }
        }
        recorder = null;
        currentFile = null;
        paused = false;
        accumulatedMs = 0;
    }

    private void stopService() {
        getContext().stopService(new Intent(getContext(), AudioRecorderService.class));
    }

    @Override
    protected void handleOnDestroy() {
        if (recorder != null) {
            try { recorder.stop(); } catch (RuntimeException ignored) { }
            releaseRecorder();
            stopService();
        }
        super.handleOnDestroy();
    }
}
