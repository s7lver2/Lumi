import { describe, it, expect, beforeEach } from "vitest";
import {
  addImage,
  getImage,
  listImages,
  removeImage,
  replaceImageBytes,
  MAX_IMAGE_BYTES,
  MAX_LIBRARY_SIZE,
  resetLibraryForTests,
} from "./image-library";

function fakeInput(overrides: Partial<Parameters<typeof addImage>[0]> = {}) {
  return {
    bytes: Buffer.from("fake-bytes"),
    filename: "photo.jpg",
    mimeType: "image/jpeg",
    width: 100,
    height: 80,
    sourceKind: "upload" as const,
    ...overrides,
  };
}

describe("image-library", () => {
  beforeEach(() => resetLibraryForTests());

  it("adds an image and retrieves it by id", () => {
    const added = addImage(fakeInput());
    expect(added.id).toBeTruthy();
    expect(getImage(added.id)).toEqual(added);
  });

  it("rejects images larger than MAX_IMAGE_BYTES", () => {
    const tooBig = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    expect(() => addImage(fakeInput({ bytes: tooBig }))).toThrow(/10 ?MB|tamaño/i);
  });

  it("lists images newest-first", () => {
    const first = addImage(fakeInput({ filename: "a.jpg" }));
    const second = addImage(fakeInput({ filename: "b.jpg" }));
    expect(listImages().map((i) => i.id)).toEqual([second.id, first.id]);
  });

  it("evicts the oldest image once MAX_LIBRARY_SIZE is exceeded", () => {
    const first = addImage(fakeInput({ filename: "first.jpg" }));
    for (let i = 1; i < MAX_LIBRARY_SIZE; i++) {
      addImage(fakeInput({ filename: `filler-${i}.jpg` }));
    }
    expect(listImages()).toHaveLength(MAX_LIBRARY_SIZE);

    addImage(fakeInput({ filename: "overflow.jpg" }));

    expect(listImages()).toHaveLength(MAX_LIBRARY_SIZE);
    expect(getImage(first.id)).toBeUndefined();
  });

  it("removes an image by id", () => {
    const added = addImage(fakeInput());
    removeImage(added.id);
    expect(getImage(added.id)).toBeUndefined();
  });

  it("replaces an image's bytes in place (used by crop) without changing its id or position", () => {
    const added = addImage(fakeInput());
    const newBytes = Buffer.from("cropped-bytes");

    const updated = replaceImageBytes(added.id, newBytes, 50, 50);

    expect(updated?.id).toBe(added.id);
    expect(updated?.bytes).toEqual(newBytes);
    expect(updated?.width).toBe(50);
    expect(getImage(added.id)?.bytes).toEqual(newBytes);
  });
});
