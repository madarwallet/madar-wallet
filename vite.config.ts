import { build, defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";

function contentScripts(): Plugin {
  return {
    name: "madar-content-scripts",
    apply: "build",
    async closeBundle() {
      const jobs = [["src/background.ts", "background.js", "es"], ["src/dapp/content.ts", "content.js", "iife"], ["src/dapp/inpage-entry.ts", "inpage.js", "iife"]] as const;
      for (const [entry, file, format] of jobs) {
        await build({
          configFile: false,
          logLevel: "warn",
          define: { "import.meta.env.DEV": "false" },
          build: {
            outDir: "dist",
            emptyOutDir: false,
            copyPublicDir: false,
            sourcemap: false,
            lib: { entry: resolve(import.meta.dirname, entry), formats: [format], name: "madarWallet", fileName: () => file },
            minify: true,
            rollupOptions: { output: { codeSplitting: false, minify: true } },
          },
        });
      }
    },
  };
}

function woff2Only(): Plugin {
  return {
    name: "madar-woff2-only",
    apply: "build",
    generateBundle(_, bundle) {
      for (const f of Object.values(bundle))
        if (f.type === "asset" && f.fileName.endsWith(".css"))
          f.source = String(f.source).replace(/,\s*url\([^)]*\.woff\)\s*format\(["']?woff["']?\)/g, "");
      for (const name of Object.keys(bundle)) if (name.endsWith(".woff")) delete bundle[name];
    },
  };
}

function androidPage(): Plugin {
  return {
    name: "madar-android-page",
    apply: "build",
    closeBundle() {
      const out = resolve(import.meta.dirname, "dist-android");
      renameSync(resolve(out, "android.html"), resolve(out, "index.html"));
      rmSync(resolve(out, "manifest.json"), { force: true });
    },
  };
}
const androidConfig = {
  plugins: [react(), woff2Only(), androidPage()],
  base: "./",

  define: { __MADAR_VERSION__: JSON.stringify(JSON.parse(readFileSync(resolve(import.meta.dirname, "public/manifest.json"), "utf8")).version) },
  build: {
    outDir: "dist-android",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: { index: resolve(import.meta.dirname, "android.html") },
      output: { entryFileNames: "assets/[name]-[hash].js" },
    },
  },
};

export default defineConfig(({ mode }) => mode === "android" ? androidConfig : {
  plugins: [react(), woff2Only(), contentScripts()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: { index: resolve(import.meta.dirname, "index.html") },
      output: { entryFileNames: "assets/[name]-[hash].js" },
    },
  },
});
