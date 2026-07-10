import { beforeEach, describe, expect, it } from "vitest";
import { setPendingFavorite, takePendingFavorite } from "./pendingFavorite";

describe("pendingFavorite", () => {
  beforeEach(() => sessionStorage.clear());

  it("set → take niyeti döner ve temizler (tek kullanımlık)", () => {
    setPendingFavorite({ type: "tutor", id: 42 });
    expect(takePendingFavorite()).toEqual({ type: "tutor", id: 42 });
    expect(takePendingFavorite()).toBeNull();
  });

  it("library tipi de desteklenir", () => {
    setPendingFavorite({ type: "library", id: 7 });
    expect(takePendingFavorite()).toEqual({ type: "library", id: 7 });
  });

  it("boş storage'da null", () => {
    expect(takePendingFavorite()).toBeNull();
  });

  it("bozuk kayıt null döner ve temizlenir", () => {
    sessionStorage.setItem("pending_favorite", "{bozuk json");
    expect(takePendingFavorite()).toBeNull();
    sessionStorage.setItem("pending_favorite", JSON.stringify({ type: "store", id: 1 }));
    expect(takePendingFavorite()).toBeNull();
    sessionStorage.setItem("pending_favorite", JSON.stringify({ type: "tutor", id: "x" }));
    expect(takePendingFavorite()).toBeNull();
  });
});
