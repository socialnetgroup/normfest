import type { NextConfig } from "next";

// Real product photos average ~800KB (up to 1.2MB) and were served
// `unoptimized` to avoid this config change - on the Katalog product page
// (own photo + up to 12 cross-sell thumbnails) that meant up to ~10MB of
// full-resolution images for a page rendering them at 96-128px. Enabling
// real optimization (resize/compress/modern format) for the Supabase
// Storage host fixes this at the source.
const nextConfig: NextConfig = {
  // @napi-rs/canvas ships a platform-specific native binary (used by the
  // Fokus flyer generator, lib/flyer/generate-focus-flyer.mjs). Next's route
  // bundler can't resolve that native binding when the package is bundled
  // normally - it works fine as a plain Node script but 500s inside the API
  // route with "Cannot find native binding" unless the package is left
  // external (required via plain Node module resolution at runtime instead
  // of being bundled).
  serverExternalPackages: ["@napi-rs/canvas"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "ethykzocikyirmoztrtq.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
