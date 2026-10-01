/**
 * Monument material palette (C5): restrained engraved-instrument colours, sRGB hex
 * converted from OKLCH. Every base is OKLab L <= 0.70 (critique: monuments <= 0.70) and
 * the shader caps the lit result at 0.70 again. No vermilion (the torii lacquer and the
 * Golden Gate rust are low-chroma brick reds, C <= 0.11, L <= 0.50).
 */
export const M = {
  limestone: '#a79d8a', //  oklch(0.70 0.030 85)
  stoneShade: '#7e7361', // oklch(0.56 0.030 80)
  sandstone: '#af8b5e', //  oklch(0.66 0.075 72)
  ochre: '#a47641', //      oklch(0.60 0.090 68)
  redstone: '#96553b', //   oklch(0.52 0.095 42)
  marble: '#a19e96', //     oklch(0.70 0.012 90)
  slate: '#3c4958', //      oklch(0.40 0.030 250)
  roof: '#3e5667', //       oklch(0.44 0.040 240)
  bronze: '#825934', //     oklch(0.50 0.075 62)
  verdigris: '#4e8778', //  oklch(0.58 0.065 175)
  brick: '#884a37', //      oklch(0.48 0.090 38)
  rust: '#964a2f', //       oklch(0.50 0.110 40)
  iron: '#3e4955', //       oklch(0.40 0.025 250)
  glass: '#566d7a', //      oklch(0.52 0.035 235)
  steelGrey: '#81878d', //  oklch(0.62 0.012 250)
  snow: '#98a0a5', //       oklch(0.70 0.012 240)
  rock: '#786c5f', //       oklch(0.54 0.025 70)
  rockDark: '#5d5045', //   oklch(0.44 0.025 60)
  water: '#7799a2', //      oklch(0.66 0.040 215)
  waterDeep: '#407083', //  oklch(0.52 0.060 225)
  mist: '#95a1a5', //       oklch(0.70 0.015 220)
  green: '#526c43', //      oklch(0.50 0.070 135)
  greenDark: '#3b5536', //  oklch(0.42 0.060 140)
  gold: '#a78749', //       oklch(0.64 0.090 82)
  coral: '#569484', //      oklch(0.62 0.070 175)
  lacquer: '#874033', //    oklch(0.46 0.100 32)
  chalk: '#a29f92', //      oklch(0.70 0.018 95)
  smoke: '#767b80', //      oklch(0.58 0.010 250)
  white: '#9b9fa3', //      oklch(0.70 0.008 250)
  dark: '#262f38', //       oklch(0.30 0.020 250)
  wood: '#634632', //       oklch(0.42 0.050 55)
} as const

/** Post-light OKLab L cap for monuments (critique: <= 0.70). */
export const MONUMENT_CAP_L = 0.7
