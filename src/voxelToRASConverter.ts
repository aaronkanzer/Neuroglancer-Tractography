import * as math from 'mathjs';
import { multiply } from 'mathjs';
import { TrkHeader } from './trkHeader';
// import fs from 'fs';
// import path from 'path';


export class VoxelToRASConverter {
    // Convert voxel to RAS using the affine matrix
    static applyAffineMatrix(point: number[], aff: number[][]): number[] {

        const [x, y, z] = point;
        const transformed = [
            aff[0][0] * x + aff[0][1] * y + aff[0][2] * z + aff[0][3],
            aff[1][0] * x + aff[1][1] * y + aff[1][2] * z + aff[1][3],
            aff[2][0] * x + aff[2][1] * y + aff[2][2] * z + aff[2][3]
        ];
        return transformed;
    }



    // Function to compute affine matrix from voxelmm space to RAS+ mm space
    static getAffineToRasmm(header: TrkHeader): number[][] {

        // const outputFilePath = path.join(__dirname, 'track_data.txt');
        // const writeStream = fs.createWriteStream(outputFilePath, { flags: 'a' });

        // Create an identity matrix for the affine transformation
        let affine = math.identity(4) as math.Matrix;

        // Apply scale: adjust voxel space based on voxel size
        const scale = math.identity(4) as math.Matrix;
        for (let i = 0; i < 3; i++) {
            scale.set([i, i], 1 / header.voxel_size[i]); // Scale by voxel size
        }
        affine = math.multiply(scale, affine) as math.Matrix;

        // Apply offset: Shift by half a voxel to account for corner/center discrepancy
        const offset = math.identity(4) as math.Matrix;
        for (let i = 0; i < 3; i++) {
            offset.set([i, 3], -0.5);
        }
        affine = math.multiply(offset, affine) as math.Matrix;
        // console.log("Affine:", affine);

        // Apply Orientation: If the voxel order implied by the affine does not match the voxel order in the TRK header, change the orientation.
        let vox_order = header.voxel_order;
        // console.log(typeof vox_order)

        const affine_ornt = VoxelToRASConverter.aff2axcodes(header.vox_to_ras);
        //  writeStream.write(`\n"Step 3: Affine Orientation (axcodes):", ${affine_ornt}`);

        // Convert voxel order to orientation array
        const header_ornt = VoxelToRASConverter.axcodes2ornt(vox_order.split(''));
        //  writeStream.write(`"Header Orientation Array:", ${header_ornt}`);

        // Convert affine orientation string to orientation array
        const affine_ornt_array = VoxelToRASConverter.axcodes2ornt(affine_ornt);
        //  writeStream.write(`" Affine Orientation Array:", ${affine_ornt_array}`);

        // Create a transformation between the header and affine orientations
        const ornt = VoxelToRASConverter.orntTransform(header_ornt, affine_ornt_array)

        // Compute the affine transformation matrix M
        const M = VoxelToRASConverter.invOrntAff(ornt, header.dim);
        //  writeStream.write(`"Affine Transformation Matrix (M):", ${M}`);

        // Update the affine matrix by applying M to the existing affine matrix
        const affine_transformed = multiply(math.matrix(M), math.matrix(affine)).toArray();
        //  writeStream.write(`"Updated Affine Matrix:", ${affine_transformed}\n`);

        // Apply voxel_to_ras transformation matrix from the header
        const voxelToRASMatrix = math.matrix(header.vox_to_ras);
        const affine_voxmm_to_rasmm = math.multiply(voxelToRASMatrix, affine_transformed) as math.Matrix;

        // Convert the final affine matrix back to a 2D array (number[][]) and return
        return affine_voxmm_to_rasmm.toArray() as number[][];

    }

    // Function to convert affine matrix to axis direction codes
    static aff2axcodes(aff: number[][], labels: [string, string][] = [['L', 'R'], ['P', 'A'], ['I', 'S']]): string[] {
        const ornt = VoxelToRASConverter.io_orientation(aff);
        return VoxelToRASConverter.ornt2axcodes(ornt, labels);
    }
    // Function to compute orientation from affine matrix
    static io_orientation(aff: number[][]): number[][] {
        const n = aff.length - 1;
        const m = aff[0].length - 1;

        if (n !== m) {
            throw new Error('Affine matrix must be square');
        }

        // Extract rotation part of the affine matrix (ignoring translation)
        const rotation = aff.slice(0, n).map(row => row.slice(0, m));

        // Singular Value Decomposition (SVD) to get the axis orientation
        const invRotation = math.inv(rotation);
        const invTrans = math.transpose(invRotation);

        // Calculate the orientation using absolute values
        const orientation = math.zeros([n, 2]) as number[][];
        for (let i = 0; i < n; i++) {
            let maxVal = 0;
            let maxIndex = 0;
            for (let j = 0; j < m; j++) {
                const val = math.abs(invTrans[i][j]);
                if (val > maxVal) {
                    maxVal = val;
                    maxIndex = j;
                }
            }
            const direction = invTrans[i][maxIndex] > 0 ? 1 : -1;
            orientation[i] = [maxIndex, direction];
        }

        return orientation;
    }
    // Function to convert orientation to axis direction labels
    static ornt2axcodes(ornt: number[][], labels: [string, string][] = [['L', 'R'], ['P', 'A'], ['I', 'S']]): string[] {
        return ornt.map(([axis, direction]) => {
            if (isNaN(axis)) {
                return '';
            }
            const axisInt = Math.round(axis);
            if (direction === 1) {
                return labels[axisInt][1];  // Positive direction
            } else if (direction === -1) {
                return labels[axisInt][0];  // Negative direction
            } else {
                throw new Error('Direction should be -1 or 1');
            }
        });
    }

    // Function to convert voxel order to orientation array
    static axcodes2ornt(axcodes: string[], labels?: [string, string][]): number[][] {
        // Default labels corresponding to RAS coordinate system
        labels = labels || [['L', 'R'], ['P', 'A'], ['I', 'S']];

        // Flatten labels for validation
        const allowedLabels: Set<string> = new Set(labels.flat());

        // Validate input axcodes
        if (!axcodes.every(axcode => allowedLabels.has(axcode))) {
            throw new Error(`Not all axis codes [${axcodes}] are in label set [${Array.from(allowedLabels)}]`);
        }

        // Create orientation array
        const nAxes: number = axcodes.length;
        const ornt: number[][] = Array.from({ length: nAxes }, () => [NaN, NaN]);

        // Fill orientation array
        axcodes.forEach((code, codeIdx) => {
            labels.forEach((codes, labelIdx) => {
                if (code === codes[0]) {
                    ornt[codeIdx] = [labelIdx, -1]; // Negative direction
                } else if (code === codes[1]) {
                    ornt[codeIdx] = [labelIdx, 1];  // Positive direction
                }
            });
        });

        return ornt;
    }

    // Funtion to convert orientation array to orientation transform
    static orntTransform(startOrnt: number[][], endOrnt: number[][]): number[][] {
        if (startOrnt.length !== endOrnt.length || startOrnt[0].length !== 2 || endOrnt[0].length !== 2) {
            throw new Error('The orientations must have the same shape and each should be an (n,2) array');
        }

        const result: number[][] = new Array(startOrnt.length).fill(null).map(() => [0, 0]);

        endOrnt.forEach((end, endInIdx) => {
            const endOutIdx = end[0];
            const endFlip = end[1];
            let found = false;

            startOrnt.forEach((start, startInIdx) => {
                const startOutIdx = start[0];
                const startFlip = start[1];

                if (endOutIdx === startOutIdx) {
                    if (startFlip === endFlip) {
                        result[startInIdx] = [endInIdx, 1];
                    } else {
                        result[startInIdx] = [endInIdx, -1];
                    }
                    found = true;
                }
            });

            if (!found) {
                throw new Error(`Unable to find out axis ${endOutIdx} in startOrnt`);
            }
        });

        return result;
    }

    // Function to compute the inverse of the orientation transform
    static invOrntAff(orntInput: number[][], shapeInput: number[]) {
        const ornt = math.matrix(orntInput);
        const p = ornt.size()[0];
        const shape = shapeInput.slice(0, p);

        const axisTranspose = ornt.toArray().map((row: any) => row[0]);
        const identityMatrix = math.identity(p + 1) as math.Matrix;

        let undoReorder = math.matrix(math.zeros(p + 1, p + 1)); // Create a zero matrix
        axisTranspose.push(p);
        axisTranspose.forEach((newIndex: number, i: number) => {
            const row = identityMatrix.subset(math.index(i, math.range(0, p + 1))) as math.Matrix;
            undoReorder = math.subset(undoReorder, math.index(newIndex, math.range(0, p + 1)), row);
        });

        // Create undo_flip as a diagonal matrix
        const flips = ornt.toArray().map((row: any) => row[1]);
        let undoFlip = math.diag([...flips, 1.0]) as math.Matrix;

        // Calculate center transformation corrections for flip
        const centerTrans = math.multiply(math.subtract(shape, 1), -0.5);
        const correction = math.multiply(flips, centerTrans);
        const updatedCenterTrans = math.subtract(correction, centerTrans);

        // Manually set the translations for flip corrections
        flips.forEach((flip, index) => {
            if (flip !== 1) { // Only adjust if there is a flip
                const value = updatedCenterTrans.get([index]);
                undoFlip = math.subset(undoFlip, math.index(index, p), value);
            }
        });

        // Compose the transformations to get the final affine transformation matrix
        const transformAffine = math.multiply(undoFlip, undoReorder);

        return transformAffine;
    }



}


