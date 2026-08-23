import type { AxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import {
  createImageSection,
  updateImageSection,
  updateRecentlyViewedSection,
} from "@/api/storeHome";
import type { StoreHomeImageSectionInput } from "@/types";

let request: AxiosRequestConfig | null = null;
let oldAdapter: unknown;

beforeEach(() => {
  request = null;
  oldAdapter = apiClient.defaults.adapter;
  apiClient.defaults.adapter = async (config) => {
    request = config;
    return { data: {}, status: 200, statusText: "OK", headers: {}, config } as never;
  };
});

afterEach(() => {
  apiClient.defaults.adapter = oldAdapter as never;
});

const base = {
  title: "Okuma seçkileri",
  description: "",
  link_url: null,
  link_label: "Tümünü gör",
  is_active: true,
  sort_order: 0,
};

function createPayload(): StoreHomeImageSectionInput {
  return {
    ...base,
    tiles: [{
      file: new File(["image"], "roman.png", { type: "image/png" }),
      existing_index: null,
      label: "Romanlar",
      alt_text: "Roman kitapları",
      link_url: "/magaza?q=roman",
    }],
  };
}

function contentType(): string {
  const headers = request?.headers as { get?: (name: string) => unknown } | undefined;
  return String(headers?.get?.("Content-Type") ?? "");
}

describe("mağaza ana sayfa görsel bölümü multipart sözleşmesi", () => {
  it("oluştururken dosya ve görsel metadatasını gönderir", async () => {
    await createImageSection(createPayload());

    expect(request?.data).toBeInstanceOf(FormData);
    expect(contentType()).toContain("multipart/form-data");
    const form = request?.data as FormData;
    expect(form.get("images")).toBeInstanceOf(File);
    expect(form.get("tiles_json")).toContain("Roman kitapları");
    expect(form.get("link_url")).toBe("");
  });

  it("güncellemede mevcut görsel indeksini korur", async () => {
    await updateImageSection(4, {
      ...base,
      tiles: [{
        file: null,
        existing_index: 0,
        label: "Romanlar",
        alt_text: "Roman kitapları",
        link_url: "/magaza?q=roman",
      }],
    });

    expect(request?.method?.toLowerCase()).toBe("put");
    const form = request?.data as FormData;
    expect(form.get("images")).toBeNull();
    expect(form.get("tiles_json")).toContain('"existing_index":0');
    expect(form.get("tiles_json")).toContain('"file_index":null');
  });

  it("kişisel vitrinde yalnız görünürlük durumunu gönderir", async () => {
    await updateRecentlyViewedSection(9, false);

    expect(request?.method?.toLowerCase()).toBe("patch");
    expect(request?.url).toBe("/admin/store-home-sections/9/recently-viewed");
    expect(JSON.parse(String(request?.data))).toEqual({ is_active: false });
  });
});
