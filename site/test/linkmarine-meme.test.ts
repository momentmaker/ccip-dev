import { describe, expect, it } from 'vitest';
import { MAX_MEME_BYTES, memeTree } from '../worker/linkmarine/meme';

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const JPEG = bytes('/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAEKADAAQAAAABAAAAEAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAEAAQAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAQEBAQEBAgEBAgMCAgIDBAMDAwMEBQQEBAQEBQYFBQUFBQUGBgYGBgYGBgcHBwcHBwgICAgICQkJCQkJCQkJCf/bAEMBAQEBAgICBAICBAkGBQYJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCf/dAAQAAf/aAAwDAQACEQMRAD8A+F6+R6+uK+R6/vz9gP8A81Z/3Jf+7Z/qB/pBX/NI/wDc9/7pn//Z');
const GIF = bytes('R0lGODlhCAAIAIEAAMgeHgAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAACAAIAAAIDwABCBxIsKDBgwgTKkwYEAAh+QQBCgABACwAAAAACAAIAIEeHsgAAAAAAAAAAAAIDwABCBxIsKDBgwgTKkwYEAA7');
const PNG_HEAD = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 144, 119, 83, 222];
const IEND = [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130];
const PNG = new Uint8Array([...PNG_HEAD, ...IEND]);
const cut = (image: Uint8Array, n: number) => image.slice(0, image.length - n);

describe('meme integrity', () => {
  it('accepts a whole PNG, a whole JPEG (with zero padding) and a whole GIF', () => {
    // #given
    const padded = new Uint8Array([...JPEG, 0, 0]);
    // #when
    const trees = [PNG, JPEG, padded, GIF].map((image) => () => memeTree(image));
    // #then
    trees.forEach((tree) => expect(tree).not.toThrow());
  });

  it('refuses a PNG, a JPEG and a GIF whose download was cut short', () => {
    // #when
    const errors = [cut(PNG, 6), cut(JPEG, 20), cut(GIF, 1)].map((image) => {
      try {
        memeTree(image);
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    });
    // #then
    expect(errors).toEqual(['prepareMeme: truncated or corrupt PNG', 'prepareMeme: truncated or corrupt JPEG', 'prepareMeme: truncated or corrupt GIF']);
  });

  it('refuses an image over 16 MB before looking inside it', () => {
    // #given
    const huge = new Uint8Array(MAX_MEME_BYTES + 1);
    huge.set(PNG_HEAD);
    // #then
    expect(() => memeTree(huge)).toThrow('prepareMeme: image over 16 MB');
  });
});
