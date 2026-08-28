import { BufferGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import { describe, expect, it, vi } from "vitest";
import { disposeModel } from "@/ldraw/loadModel";
import type { ModelData } from "@/ldraw/types";

/**
 * Teardown for the viewer's GPU resources.
 *
 * Worth testing on its own because nothing observable goes wrong when it is
 * incomplete: the model still unmounts, and the leak only shows up as a browser
 * tab that grows a few hundred megabytes per model opened. The one rule is that
 * every geometry and material under the root is disposed exactly once, however
 * many meshes happen to share it.
 */
function modelWith(root: Group): ModelData {
  return {
    bags: [],
    bom: [],
    bounds: { isBox3: true } as unknown as ModelData["bounds"],
    bricks: [],
    credit: null,
    expectedBricks: null,
    root,
    slug: "test",
    smoothNormals: false,
    steps: [],
    stepsAreSynthetic: false,
    submodels: { brickIds: [], children: [], name: "root", path: "" },
    title: "Test",
  } as unknown as ModelData;
}

const meshWith = (material: Mesh["material"]) => {
  const mesh = new Mesh(new BufferGeometry(), undefined);
  mesh.material = material;
  return mesh;
};

describe("disposeModel", () => {
  it("disposes the geometry and material of every mesh under the root", () => {
    const geometry = new BufferGeometry();
    const material = new MeshStandardMaterial();
    const geometrySpy = vi.spyOn(geometry, "dispose");
    const materialSpy = vi.spyOn(material, "dispose");

    const root = new Group();
    const mesh = new Mesh(geometry, material);
    root.add(mesh);

    disposeModel(modelWith(root));

    expect(geometrySpy).toHaveBeenCalledTimes(1);
    expect(materialSpy).toHaveBeenCalledTimes(1);
  });

  it("disposes a shared material once, not once per mesh that uses it", () => {
    // The whole point of the material cache is that every red brick shares one
    // material. Disposing per mesh would call dispose on a freed resource.
    const material = new MeshStandardMaterial();
    const spy = vi.spyOn(material, "dispose");

    const root = new Group();
    root.add(meshWith(material), meshWith(material), meshWith(material));

    disposeModel(modelWith(root));

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("disposes every material of a mesh that carries an array of them", () => {
    // A multi-material mesh holds an array, and indexing it as one object
    // silently leaks all but the first.
    const materials = [new MeshStandardMaterial(), new MeshStandardMaterial()];
    const spies = materials.map((m) => vi.spyOn(m, "dispose"));

    const root = new Group();
    root.add(meshWith(materials));

    disposeModel(modelWith(root));

    for (const spy of spies) {
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });

  it("descends into nested groups, which is how submodels arrive", () => {
    const geometry = new BufferGeometry();
    const spy = vi.spyOn(geometry, "dispose");

    const root = new Group();
    const submodel = new Group();
    submodel.add(new Mesh(geometry, new MeshStandardMaterial()));
    root.add(submodel);

    disposeModel(modelWith(root));

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("empties the root, so nothing keeps the disposed objects alive", () => {
    const root = new Group();
    root.add(new Mesh(new BufferGeometry(), new MeshStandardMaterial()));

    disposeModel(modelWith(root));

    expect(root.children).toHaveLength(0);
  });

  it("survives an object with neither geometry nor material", () => {
    const root = new Group();
    root.add(new Group());

    expect(() => disposeModel(modelWith(root))).not.toThrow();
  });
});
