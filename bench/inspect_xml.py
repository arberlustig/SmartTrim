import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
tree = ET.parse(path)
root = tree.getroot()

def t(el, tag, default=None):
    f = el.find(tag)
    return f.text if f is not None and f.text is not None else default

seq = root.find("sequence")
print(f"xmeml version : {root.get('version')}")
print(f"sequence attrs: explodedTracks={seq.get('explodedTracks')}")
print(f"name          : {t(seq, 'name')}")
rate = seq.find("rate")
print(f"timebase      : {t(rate,'timebase')}  ntsc={t(rate,'ntsc')}")

vfmt = seq.find("media/video/format/samplecharacteristics")
if vfmt is not None:
    print(f"video format  : {t(vfmt,'width')}x{t(vfmt,'height')}  par={t(vfmt,'pixelaspectratio')}")

print("\n=== <file> Definitionen (Quellmedien) ===")
for f in seq.iter("file"):
    if len(f) == 0:
        continue
    fa = f.find("media/audio")
    n_at = len(f.findall("media/audio/audiochannel")) if fa is not None else 0
    print(f"  file id={f.get('id')}  name={t(f,'name')}")
    if fa is not None:
        sc = fa.find("samplecharacteristics")
        print(f"    audio: channelcount={t(fa,'channelcount')}  "
              f"depth={t(sc,'depth') if sc is not None else '?'}  "
              f"rate={t(sc,'samplerate') if sc is not None else '?'}  audiochannel-Elemente={n_at}")
        for sub in fa:
            if sub.tag not in ("samplecharacteristics", "channelcount"):
                print(f"      <{sub.tag}> {''.join(sub.itertext()).strip()[:80]}")

print("\n=== Sequenz-Audiospuren ===")
audio = seq.find("media/audio")
if audio is not None:
    print(f"  numOutputChannels={t(audio,'numOutputChannels')}")
    outs = audio.find("outputs")
    if outs is not None:
        for g in outs.findall("group"):
            chans = [t(c, "index") for c in g.findall("channel")]
            print(f"  output group index={t(g,'index')} numchannels={t(g,'numchannels')} "
                  f"downmix={t(g,'downmix')} channels={chans}")
    for i, tr in enumerate(audio.findall("track"), 1):
        print(f"\n  --- Spur {i} ---")
        print(f"    premiereTrackType     = {tr.get('premiereTrackType')}")
        print(f"    currentExplodedTrackIndex = {tr.get('currentExplodedTrackIndex')}")
        print(f"    totalExplodedTrackCount   = {tr.get('totalExplodedTrackCount')}")
        print(f"    MZ.TrackTargeted      = {tr.get('MZ.TrackTargeted')}")
        for ci in tr.findall("clipitem"):
            st = ci.find("sourcetrack")
            sti = t(st, "trackindex") if st is not None else "-"
            links = ci.findall("link")
            ldesc = ",".join(f"{t(l,'mediatype')[0]}{t(l,'trackindex')}g{t(l,'groupindex','-')}" for l in links)
            print(f"      clipitem id={ci.get('id')} chType={ci.get('premiereChannelType')} "
                  f"master={t(ci,'masterclipid')} file={ci.find('file').get('id') if ci.find('file') is not None else '-'} "
                  f"sourcetrack.trackindex={sti} start={t(ci,'start')} end={t(ci,'end')} in={t(ci,'in')} out={t(ci,'out')}")
            print(f"        links: {ldesc}")

print("\n=== Sequenz-Videospuren ===")
video = seq.find("media/video")
if video is not None:
    for i, tr in enumerate(video.findall("track"), 1):
        for ci in tr.findall("clipitem"):
            st = ci.find("sourcetrack")
            print(f"  clipitem id={ci.get('id')} master={t(ci,'masterclipid')} "
                  f"sourcetrack={t(st,'trackindex') if st is not None else '-'} "
                  f"start={t(ci,'start')} end={t(ci,'end')} in={t(ci,'in')} out={t(ci,'out')}")
