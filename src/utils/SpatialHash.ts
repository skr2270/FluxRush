export interface SpatialHashEntity {
  pos: { x: number; y: number };
  size: number;
}

export class SpatialHash<T extends SpatialHashEntity> {
  private cellSize: number;
  private cols: number;
  private rows: number;
  
  // Flat grid of cells. Each cell contains an array of entities.
  // To avoid allocations, we pre-allocate these arrays once and clear them.
  private grid: T[][];
  private maxEntitiesPerCell = 128;

  constructor(width: number, height: number, cellSize = 100) {
    this.cellSize = cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    
    const numCells = this.cols * this.rows;
    this.grid = new Array(numCells);
    for (let i = 0; i < numCells; i++) {
      this.grid[i] = [];
    }
  }

  public resize(width: number, height: number): void {
    this.cols = Math.ceil(width / this.cellSize);
    this.rows = Math.ceil(height / this.cellSize);
    const numCells = this.cols * this.rows;
    
    // Resize grid array if it grows
    if (numCells > this.grid.length) {
      const oldLen = this.grid.length;
      this.grid.length = numCells;
      for (let i = oldLen; i < numCells; i++) {
        this.grid[i] = [];
      }
    }
  }

  public clear(): void {
    const len = this.cols * this.rows;
    for (let i = 0; i < len; i++) {
      this.grid[i].length = 0; // Clear in-place, keeping array memory allocated
    }
  }

  public insert(entity: T): void {
    const cellX = Math.floor(entity.pos.x / this.cellSize);
    const cellY = Math.floor(entity.pos.y / this.cellSize);

    // Bounds safety
    if (cellX < 0 || cellX >= this.cols || cellY < 0 || cellY >= this.rows) {
      return;
    }

    const index = cellY * this.cols + cellX;
    const cell = this.grid[index];
    if (cell.length < this.maxEntitiesPerCell) {
      cell.push(entity);
    }
  }

  /**
   * Finds potential collision candidates near (x, y) within radius.
   * Fills `outList` in-place and returns the number of candidates found.
   */
  public query(x: number, y: number, radius: number, outList: T[]): number {
    outList.length = 0;

    const startCellX = Math.floor((x - radius) / this.cellSize);
    const endCellX = Math.floor((x + radius) / this.cellSize);
    const startCellY = Math.floor((y - radius) / this.cellSize);
    const endCellY = Math.floor((y + radius) / this.cellSize);

    let count = 0;

    for (let cy = startCellY; cy <= endCellY; cy++) {
      if (cy < 0 || cy >= this.rows) continue;
      
      const rowOffset = cy * this.cols;
      for (let cx = startCellX; cx <= endCellX; cx++) {
        if (cx < 0 || cx >= this.cols) continue;

        const cellIndex = rowOffset + cx;
        const cell = this.grid[cellIndex];
        
        for (let i = 0; i < cell.length; i++) {
          outList.push(cell[i]);
          count++;
        }
      }
    }

    return count;
  }
}
