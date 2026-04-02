import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The images-and-labels directory
const baseDir = path.join(__dirname, 'images-and-labels');
const imagesDir = path.join(baseDir, 'images');
const labelsDir = path.join(baseDir, 'labels');

// Create the directories if they don't exist
if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
}
if (!fs.existsSync(labelsDir)) {
    fs.mkdirSync(labelsDir, { recursive: true });
}

const files = fs.readdirSync(baseDir);

let imagesCount = 0;
let labelsCount = 0;

for (const file of files) {
    const filePath = path.join(baseDir, file);

    // Skip directories to avoid moving the newly created images/ and labels/ folders
    if (fs.statSync(filePath).isDirectory()) continue;

    if (file.toLowerCase().endsWith('.png') || file.toLowerCase().endsWith('.jpg') || file.toLowerCase().endsWith('.jpeg')) {
        fs.renameSync(filePath, path.join(imagesDir, file));
        imagesCount++;
    } else if (file.toLowerCase().endsWith('.json')) {
        fs.renameSync(filePath, path.join(labelsDir, file));
        labelsCount++;
    }
}

console.log(`Separation complete!`);
console.log(`Moved ${imagesCount} images to content/images-and-labels/images/`);
console.log(`Moved ${labelsCount} label files to content/images-and-labels/labels/`);
