#!/usr/bin/env sh

mkdir images-and-labels/images/ images-and-labels/labels/

cd images-and-labels/

png_files=$(fd "png")
json_files=$(fd "json")

for png in $png_files
do
  ln -s ../$png images/$png

done

for json in $json_files
do
  ln -s ../$json labels/$json
done
