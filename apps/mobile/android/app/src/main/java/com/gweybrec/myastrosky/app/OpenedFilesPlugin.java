package com.gweybrec.myastrosky.app;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Files another app hands to MyAstroSky ("Ouvrir avec", or "Partager"): the intent's addresses are kept, then copied
 * into the app's cache when the page takes them (a FITS file can be large: the copy runs off the main thread). A file
 * opened while the app runs fires `openedFiles`, and the page takes it the same way.
 */
@CapacitorPlugin(name = "OpenedFiles")
public class OpenedFilesPlugin extends Plugin {
    private static final String CACHE_FOLDER = "opened";
    private final List<Uri> waiting = new ArrayList<>();

    @Override
    public void load() {
        collect(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (collect(intent)) notifyListeners("openedFiles", new JSObject());
    }

    /** The files waiting, copied into the cache: `{ files: [{ path, name, mimeType }] }`. */
    @PluginMethod
    public void take(PluginCall call) {
        final List<Uri> uris;
        synchronized (waiting) {
            uris = new ArrayList<>(waiting);
            waiting.clear();
        }
        new Thread(() -> {
            File folder = new File(getContext().getCacheDir(), CACHE_FOLDER);
            // The files of an earlier take were read by the page already.
            if (!uris.isEmpty()) deleteTree(folder);
            JSArray files = new JSArray();
            for (Uri uri : uris) {
                JSObject file = copyToCache(uri, folder);
                if (file != null) files.put(file);
            }
            JSObject result = new JSObject();
            result.put("files", files);
            call.resolve(result);
        }).start();
    }

    /** Keeps the files of a VIEW, SEND or SEND_MULTIPLE intent; true when there was one. */
    @SuppressWarnings("deprecation")
    private boolean collect(Intent intent) {
        if (intent == null || intent.getAction() == null) return false;
        List<Uri> uris = new ArrayList<>();
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {
            uris.add(intent.getData());
        } else if (Intent.ACTION_SEND.equals(action)) {
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri != null) uris.add(uri);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        }
        if (uris.isEmpty()) return false;
        synchronized (waiting) {
            waiting.addAll(uris);
        }
        // Taken once: the same intent read again (the activity recreated) adds nothing.
        intent.setAction(Intent.ACTION_MAIN);
        intent.setData(null);
        intent.removeExtra(Intent.EXTRA_STREAM);
        return true;
    }

    private JSObject copyToCache(Uri uri, File folder) {
        ContentResolver resolver = getContext().getContentResolver();
        String name = displayName(resolver, uri);
        File target = new File(new File(folder, UUID.randomUUID().toString()), name);
        if (!target.getParentFile().mkdirs()) return null;
        try (InputStream in = resolver.openInputStream(uri); OutputStream out = new FileOutputStream(target)) {
            if (in == null) return null;
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
        } catch (Exception e) {
            return null;
        }
        JSObject file = new JSObject();
        file.put("path", target.getAbsolutePath());
        file.put("name", name);
        String type = resolver.getType(uri);
        file.put("mimeType", type == null ? "" : type);
        return file;
    }

    /** The file's name as the other app gives it, without any folder. */
    private static String displayName(ContentResolver resolver, Uri uri) {
        String name = null;
        if (ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) {
            try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
            } catch (Exception ignored) {
                // Falls back on the address below.
            }
        }
        if (name == null) name = uri.getLastPathSegment();
        if (name == null || name.isEmpty()) name = "photo";
        return new File(name).getName();
    }

    private static void deleteTree(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        file.delete();
    }
}
