// node build.mjs <framesDir> <voDir> <out.mp4>: frames + voiceover clips at
// their marks + the recorded music (ducked under the voice).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const [dir, voDir, out] = process.argv.slice(2);
const { frames, end, marks = {} } = JSON.parse(readFileSync(`${dir}/frames.json`, "utf8"));
const dur = JSON.parse(readFileSync(`${voDir}/durations.json`, "utf8"));
let list = "";
frames.forEach((f, i) => { list += `file '${dir}/${f.file}'\nduration ${Math.max(0.01, (frames[i + 1]?.t ?? end) - f.t).toFixed(3)}\n`; });
list += `file '${dir}/${frames.at(-1).file}'\n`;
writeFileSync(`${dir}/list.txt`, list);
const inputs = ["-f", "concat", "-safe", "0", "-i", `${dir}/list.txt`];
const filters = [], mix = [];
const vos = Object.keys(marks).filter((k) => k.startsWith("vo:")).map((k) => ({ key: k.slice(3), at: marks[k] }));
if (existsSync(`${dir}/audio.bin`) && marks.music != null && marks.stop != null) {
  inputs.push("-i", `${dir}/audio.bin`);
  const len = marks.stop - marks.music + 0.3;
  const duck = vos.filter((v) => v.at < marks.stop && v.at + dur[v.key] > marks.music)
    .map((v) => `between(t,${(v.at - marks.music - 0.15).toFixed(2)},${(v.at - marks.music + dur[v.key] + 0.2).toFixed(2)})`).join("+") || "0";
  filters.push(`[1:a]aresample=48000,atrim=0:${len.toFixed(2)},afade=t=out:st=${(len - 0.6).toFixed(2)}:d=0.6,volume=0.35:enable='${duck}',adelay=${Math.round(marks.music * 1000)}:all=1[m]`);
  mix.push("[m]");
}
for (const v of vos) {
  const n = inputs.filter((x) => x === "-i").length;
  inputs.push("-i", `${voDir}/${v.key}.wav`);
  filters.push(`[${n}:a]aresample=48000,volume=1.6,adelay=${Math.round(v.at * 1000)}:all=1[v${n}]`);
  mix.push(`[v${n}]`);
}
filters.push(`${mix.join("")}amix=inputs=${mix.length}:normalize=0:dropout_transition=0,alimiter=limit=0.95,apad[a]`);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", filters.join(";"),
  "-map", "0:v", "-map", "[a]", "-t", end.toFixed(2), "-c:a", "aac", "-b:a", "160k",
  "-vf", "fps=30,scale=824:-2:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-movflags", "+faststart", out]);
