package app.frame.mobile;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.content.ContentValues;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;

@CapacitorPlugin(name = "FrameDocument")
public class FrameDocumentPlugin extends Plugin {
    @PluginMethod
    public void saveImage(PluginCall call) {
        String filename = call.getString("filename");
        if (filename == null || !filename.endsWith(".png") || filename.length() > 240 || filename.contains("..") || filename.contains("/") || filename.contains("\\")) {
            call.reject("Invalid image filename");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("Gallery export requires Android 10 or later");
            return;
        }
        Uri destination = null;
        try {
            File root = getContext().getCacheDir().getCanonicalFile();
            File source = new File(root, filename).getCanonicalFile();
            if (!source.getParentFile().equals(root) || !source.isFile()) {
                call.reject("Temporary PNG not found");
                return;
            }
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, filename);
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
            values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/FRAME");
            values.put(MediaStore.Images.Media.IS_PENDING, 1);
            destination = getContext().getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (destination == null) throw new java.io.IOException("Cannot create gallery image");
            try (InputStream input = new FileInputStream(source);
                 OutputStream output = getContext().getContentResolver().openOutputStream(destination, "w")) {
                if (output == null) throw new java.io.IOException("Cannot write gallery image");
                byte[] buffer = new byte[65536];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            }
            ContentValues ready = new ContentValues();
            ready.put(MediaStore.Images.Media.IS_PENDING, 0);
            getContext().getContentResolver().update(destination, ready, null, null);
            JSObject response = new JSObject();
            response.put("saved", true);
            call.resolve(response);
        } catch (Exception error) {
            if (destination != null) getContext().getContentResolver().delete(destination, null, null);
            call.reject("Could not save PNG: " + error.getMessage());
        }
    }

    @PluginMethod
    public void saveBackup(PluginCall call) {
        String filename = call.getString("filename");
        if (filename == null || !filename.endsWith(".frame") || filename.length() > 240 || filename.contains("..") || filename.contains("/") || filename.contains("\\")) {
            call.reject("Invalid backup filename");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/octet-stream");
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(call, intent, "onDocumentSelected");
    }

    @ActivityCallback
    private void onDocumentSelected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject response = new JSObject();
            response.put("cancelled", true);
            call.resolve(response);
            return;
        }
        try {
            String filename = call.getString("filename");
            File root = getContext().getCacheDir().getCanonicalFile();
            File source = new File(root, filename).getCanonicalFile();
            if (!source.getParentFile().equals(root) || !source.isFile()) {
                call.reject("Temporary backup not found");
                return;
            }
            Uri destination = result.getData().getData();
            try (InputStream input = new FileInputStream(source);
                 OutputStream output = getContext().getContentResolver().openOutputStream(destination, "w")) {
                if (output == null) throw new java.io.IOException("Cannot open selected destination");
                byte[] buffer = new byte[65536];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                output.flush();
            }
            JSObject response = new JSObject();
            response.put("cancelled", false);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Could not save backup: " + error.getMessage());
        }
    }
}
