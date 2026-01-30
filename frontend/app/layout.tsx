import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "Logcraft AI",
    description: "AI-powered log analysis",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
