package com.gweybrec.myastrosky.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Files opened with MyAstroSky from another app (src/open-with.ts takes them).
        registerPlugin(OpenedFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
