import type { Camera, Object3D } from "three";

export class FakeWebGLRenderer {
  domElement = document.createElement("canvas");
  private rect = new DOMRect();

  constructor() {
    this.domElement.getBoundingClientRect = () => this.rect;
  }

  setPixelRatio() {}
  setClearColor() {}
  setSize(width: number, height: number) {
    this.rect = new DOMRect(0, 0, width, height);
  }
  render(scene: Object3D, camera: Camera) {
    scene.updateMatrixWorld();
    if (camera.parent === null) camera.updateMatrixWorld();
  }
  dispose() {}
}
