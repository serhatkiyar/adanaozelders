import type { AxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import {
  createCustomStoreShowcaseCard,
  updateCustomStoreShowcaseCard,
} from "@/api/storeShowcase";
import type { StoreShowcaseCustomCardInput } from "@/types";

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

function payload(): StoreShowcaseCustomCardInput {
  return {
    title: "Sınav seçkisi",
    description: "",
    link_url: "/magaza",
    link_label: "Tümünü gör",
    is_active: true,
    sort_order: 0,
    tiles: [{
      file: new File(["image"], "seçki.png", { type: "image/png" }),
      existing_index: null,
      label: "TYT",
      alt_text: "TYT hazırlık kitapları",
      link_url: "/magaza?q=TYT",
    }],
  };
}

function contentType(): string {
  const headers = request?.headers as { get?: (name: string) => unknown } | undefined;
  return String(headers?.get?.("Content-Type") ?? "");
}

describe("özel vitrin kartı multipart sözleşmesi", () => {
  it("oluşturma isteğini FormData ve multipart başlığıyla gönderir", async () => {
    await createCustomStoreShowcaseCard(payload());

    expect(request?.data).toBeInstanceOf(FormData);
    expect(contentType()).toContain("multipart/form-data");
    expect((request?.data as FormData).get("images")).toBeInstanceOf(File);
    expect((request?.data as FormData).get("tiles_json")).toContain("alt_text");
    expect((request?.data as FormData).get("link_label")).toBe("Tümünü gör");
  });

  it("güncelleme isteğini de FormData ve multipart başlığıyla gönderir", async () => {
    await updateCustomStoreShowcaseCard(6, payload());

    expect(request?.method?.toLowerCase()).toBe("put");
    expect(request?.data).toBeInstanceOf(FormData);
    expect(contentType()).toContain("multipart/form-data");
    expect((request?.data as FormData).get("link_label")).toBe("Tümünü gör");
  });
});
