package com.gweybrec.myastrosky.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Files opened with MyAstroSky from another app (src/open-with.ts takes them).
        registerPlugin(OpenedFilesPlugin.class);
        // The live plan's notifications (src/live-alerts-native.ts).
        registerPlugin(LivePlanPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
