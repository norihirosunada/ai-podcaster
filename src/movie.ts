import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import { createCanvas, loadImage } from "canvas";

const c_imageWidth = 1280; // not 1920
const c_imageHeight = 720; // not 1080

async function renderJapaneseTextToPNG(text: string, outputFilePath: string) {
  const columns = Math.sqrt(text.length / 2) * 2;
  const fontSize = c_imageWidth / Math.max(columns, 20);
  const lineHeight = fontSize * 1.2;

  const lines: string[] = [];
  let currentLine = "";
  let currentWidth = 0;

  // Iterate over each character and determine line breaks based on character width estimate
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const code = char.charCodeAt(0);
    const isAnsi = code < 255;
    const isCapital = code >= 0x40 && code < 0x60;
    const charWidth = isAnsi
      ? isCapital
        ? fontSize * 0.8
        : fontSize * 0.5
      : fontSize;

    if (char === "\n") {
      lines.push(currentLine);
      currentLine = "";
      currentWidth = 0;
    } else if (currentWidth + charWidth > c_imageWidth) {
      lines.push(currentLine);
      currentLine = char;
      currentWidth = charWidth;
    } else {
      currentLine += char;
      currentWidth += charWidth;
    }
  }

  // Push the last line if there's any remaining text
  if (currentLine) {
    lines.push(currentLine);
  }

  const imageHeight = lines.length * lineHeight;

  // Create a canvas and a drawing context
  const canvas = createCanvas(c_imageWidth, c_imageHeight);
  const context = canvas.getContext("2d");

  // Set background color
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, c_imageWidth, imageHeight);

  // Set text styles
  context.font = "bold 40px Arial";
  context.fillStyle = "#000000";
  context.textAlign = "center";
  context.textBaseline = "top";

  lines.forEach((line:string, index:number) => {
    context.fillText(line, c_imageWidth / 2, lineHeight * index);
  });

  // Save the image
  const buffer = canvas.toBuffer("image/png");
  fs.writeFileSync(outputFilePath, buffer);

  /*
  // Create SVG content for Japanese text rendering
  const svgContent = `
    <svg width="${c_imageWidth}" height="${Math.max(imageHeight, c_imageHeight)}" xmlns="http://www.w3.org/2000/svg">
      <text x="0" y="${fontSize}" font-size="${fontSize}" font-family="Arial" fill="black">
        ${lines.map((line, index) => `<tspan x="2" y="${fontSize + index * lineHeight + 2}">${line}</tspan>`).join("")}
      </text>
      <text x="0" y="${fontSize}" font-size="${fontSize}" font-family="Arial" fill="black">
        ${lines.map((line, index) => `<tspan x="-2" y="${fontSize + index * lineHeight - 2}">${line}</tspan>`).join("")}
      </text>
      <text x="0" y="${fontSize}" font-size="${fontSize}" font-family="Arial" fill="black">
        ${lines.map((line, index) => `<tspan x="2" y="${fontSize + index * lineHeight - 2}">${line}</tspan>`).join("")}
      </text>
      <text x="0" y="${fontSize}" font-size="${fontSize}" font-family="Arial" fill="black">
        ${lines.map((line, index) => `<tspan x="-2" y="${fontSize + index * lineHeight + 2}">${line}</tspan>`).join("")}
      </text>
      <text x="0" y="${fontSize}" font-size="${fontSize}" font-family="Arial" fill="white">
        ${lines.map((line, index) => `<tspan x="0" y="${fontSize + index * lineHeight}">${line}</tspan>`).join("")}
      </text>
    </svg>
  `;

  // Use sharp to convert the SVG to PNG
  await sharp(Buffer.from(svgContent)).png().toFile(outputFilePath);
  */
  console.log(`Image saved to ${outputFilePath}`);
}

interface ImageDetails {
  path: string;
  duration: number; // Duration in seconds for each image
}

const createVideo = (
  audioPath: string,
  images: ImageDetails[],
  outputVideoPath: string,
) => {
  let command = ffmpeg();

  // Add each image input
  images.forEach((image) => {
    command = command.input(image.path);
  });

  // Build filter_complex string to manage start times
  const filterComplexParts: string[] = [];

  let startTime = 0; // Start time for each image
  images.forEach((image, index) => {
    // Add filter for each image
    filterComplexParts.push(
      `[${index}:v]scale=${c_imageWidth}:${c_imageHeight},setsar=1,format=yuv420p,trim=duration=${image.duration},setpts=PTS+${startTime}/TB[v${index}]`,
    );
    startTime = image.duration; // Update start time for the next image
  });

  // Concatenate the trimmed images
  const concatInput = images.map((_, index) => `[v${index}]`).join("");
  filterComplexParts.push(`${concatInput}concat=n=${images.length}:v=1:a=0[v]`);

  // Apply the filter complex for concatenation and map audio input
  command
    .complexFilter(filterComplexParts)
    .input(audioPath) // Add audio input
    .outputOptions([
      "-map [v]", // Map the video stream
      "-map " + images.length + ":a", // Map the audio stream (audio is the next input after all images)
      "-c:v libx264", // Set video codec
      "-r 30", // Set frame rate
      "-pix_fmt yuv420p", // Set pixel format for better compatibility
    ])
    .on("start", (cmdLine) => {
      console.log("Started FFmpeg ..."); // with command:', cmdLine);
    })
    .on("error", (err, stdout, stderr) => {
      console.error("Error occurred:", err);
      console.error("FFmpeg stdout:", stdout);
      console.error("FFmpeg stderr:", stderr);
    })
    .on("end", () => {
      console.log("Video created successfully!");
    })
    .output(outputVideoPath)
    .run();
};

const main = async () => {
  const arg2 = process.argv[2];
  const scriptPath = path.resolve(arg2);
  const parsedPath = path.parse(scriptPath);
  const name = parsedPath.name;
  const data = fs.readFileSync(scriptPath, "utf-8");
  const jsonData = JSON.parse(data);
  //
  await renderJapaneseTextToPNG(
    `${jsonData.title}\n\n${jsonData.description}`,
    `./scratchpad/${name}_00.png`, // Output file path
  ).catch((err) => {
    console.error("Error generating PNG:", err);
  });

  const promises = jsonData.script.map((element: any, index: number) => {
    return renderJapaneseTextToPNG(
      element["text"],
      `./scratchpad/${name}_${index}.png`, // Output file path
    ).catch((err) => {
      console.error("Error generating PNG:", err);
    });
  });
  await Promise.all(promises);

  const tmScriptPath = path.resolve("./output/" + name + ".json");
  const dataTm = fs.readFileSync(tmScriptPath, "utf-8");
  const jsonDataTm = JSON.parse(dataTm);

  // add images
  const imageInfo = jsonDataTm.imageInfo;
  await imageInfo.forEach(async (element: { index: number; image: string }) => {
    const { index, image } = element;
    if (image) {
      const imagePath = `./scratchpad/${name}_${index}.png`;
      const imageText = await loadImage(imagePath);
      const imageBG = await loadImage(image);
      const bgWidth = imageBG.width;
      const bgHeight = imageBG.height;
      const viewWidth = (bgWidth / bgHeight) * c_imageHeight;
      const canvas = createCanvas(c_imageWidth, c_imageHeight);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(
        imageBG,
        (c_imageWidth - viewWidth) / 2,
        0,
        viewWidth,
        c_imageHeight,
      );
      ctx.drawImage(imageText, 0, 0);
      const buffer = canvas.toBuffer("image/png");
      fs.writeFileSync(imagePath, buffer);
    }
  });

  const audioPath = path.resolve("./output/" + name + "_bgm.mp3");
  const images: ImageDetails[] = jsonDataTm.script.map(
    (item: any, index: number) => {
      const duration = item.duration;
      return {
        path: path.resolve(`./scratchpad/${name}_${index}.png`),
        duration,
      };
    },
  );
  const outputVideoPath = path.resolve("./output/" + name + "_ja.mp4");
  const titleImage: ImageDetails = {
    path: path.resolve(`./scratchpad/${name}_00.png`),
    duration: 4,
  };
  const imagesWithTitle = [titleImage].concat(images);

  createVideo(audioPath, imagesWithTitle, outputVideoPath);
};

main();
