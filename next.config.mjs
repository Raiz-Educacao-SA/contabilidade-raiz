/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["pdf-to-img", "tesseract.js"],
};

export default nextConfig;
