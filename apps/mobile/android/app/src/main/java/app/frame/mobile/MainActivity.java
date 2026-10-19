package app.frame.mobile;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FrameDocumentPlugin.class);
        super.onCreate(savedInstanceState);
    }}
