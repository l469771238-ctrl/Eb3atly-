package com.eb3atly.recorder;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the local plugin before the bridge starts.
        registerPlugin(AudioRecorderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
