import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* /method was the limits page until the site was reorganised. Its content
     now lives in the limits section of /how-it-works, so an old link lands on
     the same material rather than a 404.

     307 rather than 308: a permanent redirect is cached by the browser more
     or less forever, and this route has already moved once. Switch `permanent`
     to true once the structure has settled. */
  redirects() {
    return Promise.resolve([
      {
        source: "/method",
        destination: "/how-it-works#limits",
        permanent: false,
      },
    ]);
  },
};

export default nextConfig;
