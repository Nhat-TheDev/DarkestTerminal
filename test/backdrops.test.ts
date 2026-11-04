import { describe, expect, test } from "bun:test";
import roomNamesJson from "../data/room-names.json";
import { allRoomNameEntries, parseRoomNames } from "../src/data/roomNames";
import { BACKDROPS, parseBackdrops, resolveScene, sceneForRoomName, type BackdropScene, type BackdropsFile } from "../src/data/backdrops";
import { propBoundsError } from "../src/ui/backdrop";

const clone = (): BackdropsFile => structuredClone(BACKDROPS);
const entries = () => allRoomNameEntries();

describe("backdrops", () => {
  test("every room name has a scene that resolves", () => {
    for (const entry of entries()) {
      expect(sceneForRoomName(entry.name), entry.name).not.toBeNull();
    }
  });

  test("a name not in room-names.json has no scene", () => {
    expect(sceneForRoomName("No Such Room")).toBeNull();
  });

  test("parseBackdrops rejects a scene pointing at a missing base / prop, a palette key with no colour, and a room entry pointing at a missing scene", () => {
    const badBase = clone();
    badBase.scenes[Object.keys(badBase.scenes)[0]!]!.base = "nope";
    expect(() => parseBackdrops(badBase, entries())).toThrow(/data\/backdrops.json/);

    const badProp = clone();
    const withProps = Object.values(badProp.scenes).find((s) => s.props.length > 0)!;
    withProps.props[0]!.prop = "nope";
    expect(() => parseBackdrops(badProp, entries())).toThrow(/data\/backdrops.json/);

    const badPalette = clone();
    const base = Object.values(badPalette.bases)[0]!;
    base.wall.rows[0] = "Z" + base.wall.rows[0]!.slice(1);
    delete base.wall.palette["Z"];
    expect(() => parseBackdrops(badPalette, entries())).toThrow(/data\/backdrops.json/);

    const missingScene = [...entries(), { name: "Ghost Room", backdrop: "ghost-room" }];
    expect(() => parseBackdrops(clone(), missingScene)).toThrow(/data\/backdrops.json/);
  });

  test("a scene's own render overrides only the fields it names", () => {
    const file = clone();
    file.render.unitShadow = { enabled: false, reachCols: 2, reachRows: 1, darkness: 0.45 };
    const id = Object.keys(file.scenes)[0]!;
    file.scenes[id]!.render = { unitShadow: { enabled: true } };
    expect(resolveScene(file, id).render.unitShadow).toEqual({ enabled: true, reachCols: 2, reachRows: 1, darkness: 0.45 });
  });

  test("every placed prop lies inside the content and above the label rows", () => {
    expect(propBoundsError(BACKDROPS)).toBeNull();
    const file = clone();
    const withProps = Object.values(file.scenes).find((s) => s.props.length > 0)!;
    withProps.props[0]!.x = 200;
    expect(propBoundsError(file)).toMatch(/outside/);
  });

  test("parseBackdrops rejects an event pointing at a missing scene", () => {
    expect(() => parseBackdrops(clone(), entries(), [{ id: "some-event", backdrop: "nowhere" }])).toThrow(/event "some-event" points at unknown scene/);
    expect(() => parseBackdrops(clone(), entries(), [{ id: "no-scene" }])).not.toThrow();
  });

  test("parseBackdrops rejects a bad rightBase, a scene without props and an over-long topFade", () => {
    const id = Object.keys(BACKDROPS.scenes)[0]!;
    const base = Object.keys(BACKDROPS.bases)[0]!;
    const unknownBase = clone();
    unknownBase.scenes[id]!.rightBase = { x: 60, base: "nope" };
    expect(() => parseBackdrops(unknownBase, entries())).toThrow(/rightBase uses unknown base/);

    const fractionalX = clone();
    fractionalX.scenes[id]!.rightBase = { x: 60.5, base };
    expect(() => parseBackdrops(fractionalX, entries())).toThrow(/rightBase x must be an integer/);

    const noProps = clone();
    delete (noProps.scenes[id] as Partial<BackdropScene>).props;
    expect(() => parseBackdrops(noProps, entries())).toThrow(/needs a list of props/);

    const longFade = clone();
    longFade.render.topFade = Array.from({ length: 19 }, () => 1);
    expect(() => parseBackdrops(longFade, entries())).toThrow(/topFade has more than/);
  });

  test("parseRoomNames rejects a missing room type and a duplicate name", () => {
    const missingRest = structuredClone(roomNamesJson) as Record<string, unknown>;
    delete missingRest.rest;
    expect(() => parseRoomNames(missingRest)).toThrow(/"rest" must be a non-empty list/);

    const duplicate = structuredClone(roomNamesJson) as Record<string, { name: string; backdrop: string }[]>;
    duplicate.boss!.push({ ...duplicate.combat![0]! });
    expect(() => parseRoomNames(duplicate)).toThrow(/duplicate room name/);
  });

  test("unit shadow is off by default", () => {
    expect(BACKDROPS.render.unitShadow.enabled).toBe(false);
  });
});
