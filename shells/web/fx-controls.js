export const insertDefinitions = Object.freeze({
  distortion:{ label:"DISTORTION", color:"#F2A26B", controls:[{id:"drive",label:"DRIVE",min:0,max:1},{id:"tone",label:"TONE",min:800,max:18000},{id:"mix",label:"MIX",min:0,max:1}] },
  chorus:{ label:"CHORUS", color:"#68C7BB", controls:[{id:"rate",label:"RATE",min:.05,max:5},{id:"depth",label:"DEPTH",min:0,max:1},{id:"width",label:"WIDTH",min:0,max:1},{id:"mix",label:"MIX",min:0,max:.65}] },
  eq:{ label:"3-BAND EQ", color:"#DCE95A", controls:[
    {id:"lowFrequency",label:"LOW FREQ",min:40,max:600,scale:"log"},
    {id:"low",label:"LOW GAIN",min:-18,max:18},
    {id:"midFrequency",label:"MID FREQ",min:200,max:8000,scale:"log"},
    {id:"midQ",label:"MID Q",min:.25,max:8},
    {id:"mid",label:"MID GAIN",min:-18,max:18},
    {id:"highFrequency",label:"HIGH FREQ",min:1500,max:18000,scale:"log"},
    {id:"high",label:"HIGH GAIN",min:-18,max:18},
  ] },
  compressor:{ label:"COMPRESSOR", color:"#F5F0E8", controls:[{id:"threshold",label:"THRESH",min:-60,max:0},{id:"ratio",label:"RATIO",min:1,max:20},{id:"attack",label:"ATTACK",min:.001,max:.2},{id:"release",label:"RELEASE",min:.03,max:1},{id:"makeup",label:"MAKEUP",min:0,max:12}] },
});
export function formatInsertValue(effect, id, value) {
  if (["mix", "drive", "depth", "width"].includes(id)) return `${Math.round(value * 100)}%`;
  if (id === "tone" || id.endsWith("Frequency")) return value >= 1000 ? `${Number((value / 1000).toFixed(2))} kHz` : `${Math.round(value)} Hz`;
  if (["low", "mid", "high", "threshold", "makeup"].includes(id)) return `${value > 0 ? "+" : ""}${Number(value.toFixed(1))} dB`;
  if (id === "ratio") return `${Number(value.toFixed(1))}:1`;
  if (id === "midQ") return `Q ${Number(value.toFixed(2))}`;
  if (id === "rate") return `${Number(value.toFixed(2))} Hz`;
  if (id === "attack" || id === "release") return `${Math.round(value * 1000)} ms`;
  return Number(value.toFixed(3)).toString();
}
export function insertSliderPosition(control, value) {
  if (control.scale !== "log") return Number(value);
  return Math.log(Number(value) / control.min) / Math.log(control.max / control.min);
}
export function insertSliderValue(control, position) {
  if (control.scale !== "log") return Number(position);
  return control.min * (control.max / control.min) ** Number(position);
}
export function insertInputUnit(id) {
  if (["mix", "drive", "depth", "width"].includes(id)) return "percent";
  if (id === "tone" || id.endsWith("Frequency") || id === "rate") return "hz";
  if (["low", "mid", "high", "threshold", "makeup"].includes(id)) return "db";
  if (id === "ratio") return "ratio";
  if (id === "midQ") return "q";
  if (id === "attack" || id === "release") return "milliseconds";
  return "number";
}
