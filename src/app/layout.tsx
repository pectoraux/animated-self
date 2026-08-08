import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "animated-self — architecture & control panel",
  description:
    "An AI-native animated self for creators who won't show their face on camera. Neural reenactment, no rigging, no Live2D. Live <100ms to OBS Virtual Cam.",
  keywords: [
    "animated-self",
    "neural reenactment",
    "THA3",
    "anime avatar",
    "OBS Virtual Camera",
    "MediaPipe",
  ],
  authors: [{ name: "animated-self" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "animated-self",
    description:
      "Neural reenactment avatar for creators — live <100ms to OBS Virtual Cam.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "animated-self",
    description:
      "Neural reenactment avatar for creators — live <100ms to OBS Virtual Cam.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-neutral-950 text-neutral-100`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
