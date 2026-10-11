import type { Camera, Object3D, Vector2 } from "three";

export class FakeWebGLRenderer {
  domElement = document.createElement("canvas");
  private rect = new DOMRect();

  constructor() {
    this.domElement.getBoundingClientRect = () => this.rect;
  }

  setPixelRatio() {}
  setClearColor() {}
  getSize(target: Vector2) {
    return target.set(this.rect.width, this.rect.height);
  }
  setSize(width: number, height: number) {
    this.rect = new DOMRect(0, 0, width, height);
  }
  render(scene: Object3D, camera: Camera) {
    scene.updateMatrixWorld();
    if (camera.parent === null) camera.updateMatrixWorld();
  }
  dispose() {}
}
