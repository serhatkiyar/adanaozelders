import type { AxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { uploadStoreMedia } from "@/api/storeMerchandising";

let request: AxiosRequestConfig | null = null;
let oldAdapter: unknown;

beforeEach(() => {
  request = null;
  oldAdapter = apiClient.defaults.adapter;
  apiClient.defaults.adapter = async (config) => {
    request = config;
    return {
      data: {},
      status: 201,
      statusText: "Created",
      headers: {},
      config,
    } as never;
  };
});

afterEach(() => {
  apiClient.defaults.adapter = oldAdapter as never;
});

describe("vitrin medya yükleme sözleşmesi", () => {
  it("görseli backend alan adlarıyla multipart gönderir", async () => {
    const image = new File(["png"], "kampanya.png", { type: "image/png" });

    await uploadStoreMedia(image, "Okula dönüş kampanyası");

    // Content-Type ELLE yazılmaz (sentinel `false`): tarayıcı boundary'yi
    // kendisi ekler. Bkz. multipartContentType.test.ts + api/store.ts'teki
    // MULTIPART sabitinin gerekçe yorumu.
    const headers = request?.headers as
      | { get?: (name: string) => unknown }
      | undefined;
    expect(headers?.get?.("Content-Type")).toBe(false);
    expect(request?.data).toBeInstanceOf(FormData);
    expect((request?.data as FormData).get("image")).toBe(image);
    expect((request?.data as FormData).get("alt_text")).toBe(
      "Okula dönüş kampanyası",
    );
  });
});
