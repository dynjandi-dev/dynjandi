import type { FocalPoint } from "@dynjandi/focal-picker";
import { FocalPicker } from "@dynjandi/focal-picker/react";
import { type FormEvent, useState } from "react";

export function UploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [focal, setFocal] = useState<FocalPoint | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (file === null) return;
    const body = new FormData();
    body.set("file", file);
    if (focal !== null) {
      body.set("focalX", String(focal.x));
      body.set("focalY", String(focal.y));
    }
    await fetch("/api/images", { method: "POST", body });
  }

  return (
    <form onSubmit={submit}>
      <input
        type="file"
        accept="image/*"
        onChange={(event) => {
          setFile(event.currentTarget.files?.[0] ?? null);
          setFocal(null);
        }}
      />
      {file !== null && <FocalPicker file={file} value={focal} onChange={setFocal} />}
      <button type="submit" disabled={file === null}>
        Upload
      </button>
    </form>
  );
}
