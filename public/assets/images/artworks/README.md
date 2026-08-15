# Card Artworks

## Source

All artworks in this folder are images from the original _Tower of God_ webtoon, taken mostly from the [wiki](https://towerofgod.fandom.com/).

## Processing

Source images went through [Google Gemini](https://gemini.google.com/) to:

- increase size and resolution
- outpaint the canvas
- remove text and speech bubbles

The prompt used was a variation of:

```plaintext
Outpaint 3:2 horizontal canvas expansion. Keep central character artwork and background elements 100% original and unscaled, do not modify the character in focus. Extend background seamlessly to the edges. Remove all text boxes, Hangul characters, and speech bubbles. do not add elements to the background or to the character artwork except for filling in necessary missing details from the canvas expansion. i want the image zoomed out to 0.5. keep faithful to the image and artwork style.
```

## Normalization

They were then cropped to 3x2 aspect ratio, upscaled to >1200x800 using [Microsoft Copilot](https://copilot.microsoft.com/), and saved at `public\assets\images\artworks\raw`.

Raw images were normalized to **1200×800 PNG** files (**3x2** aspect ratio) using `magick`:

```sh
magick mogrify -path .\public\assets\images\artworks\ -filter Lanczos -resize "1200x800>" .\public\assets\images\artworks\raw\*.png
```
