import { ImageResponse } from "next/og";
import { Code2 } from "lucide-react";

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#070d24",
          borderRadius: 8,
          color: "#ffffff",
          display: "flex",
          height: "100%",
          justifyContent: "center",
          width: "100%",
        }}
      >
        <Code2 size={16} strokeWidth={2} />
      </div>
    ),
    size,
  );
}
