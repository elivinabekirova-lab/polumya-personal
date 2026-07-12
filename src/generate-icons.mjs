import sharp from "sharp";

const svg = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="110" fill="#1C1A17"/>
  <path d="M256 70c38 82-83 128-83 241a105 105 0 0 0 210 0c0-59-35-91-51-137-29 26-39 59-31 91-37-37-66-105-45-195z" fill="#E8763A"/>
  <path d="M105 436h302l-55-70H160l-55 70z" fill="#6B7F5E"/>
</svg>`;

await sharp(Buffer.from(svg)).resize(192, 192).png().toFile("public/icon-192.png");
await sharp(Buffer.from(svg)).resize(512, 512).png().toFile("public/icon-512.png");
await sharp(Buffer.from(svg)).resize(180, 180).png().toFile("public/apple-touch-icon.png");

console.log("Іконки створені");
