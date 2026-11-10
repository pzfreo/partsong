# One take of every line in nova, split per line by Whisper word times; a line
# missing from the take (nova sometimes stops early) is made on its own.
import json,os,re,subprocess,urllib.request
INS="Speak throughout with a natural, unmistakably British accent: southern English Received Pronunciation, like a BBC Radio 4 presenter. Never American. One woman, warm and friendly, clear and unhurried, like a choir director showing a singer something useful. Not salesy."
KEY=os.environ["OPENAI_API_KEY"]
def tts(text,out,extra=""):
    body=json.dumps({"model":"gpt-4o-mini-tts","voice":"nova","input":text,"response_format":"wav","instructions":INS+extra}).encode()
    r=urllib.request.Request("https://api.openai.com/v1/audio/speech",data=body,headers={"Authorization":"Bearer "+KEY,"Content-Type":"application/json"})
    open(out,"wb").write(urllib.request.urlopen(r).read())
def words(f):
    out=subprocess.check_output(["curl","-s","https://api.openai.com/v1/audio/transcriptions","-H","Authorization: Bearer "+KEY,"-F",f"file=@{f}","-F","model=whisper-1","-F","response_format=verbose_json","-F","timestamp_granularities[]=word"])
    return json.loads(out)["words"]
norm=lambda s:re.sub(r"[^a-z0-9]","",s.lower())
lines=json.load(open("lines.json"))
tts("\n\n".join(lines.values()),"all.wav"," Pause for about a second between paragraphs.")
W=[(norm(w["word"]),w["start"],w["end"]) for w in words("all.wav")]
sil=[]
o=subprocess.run(["ffmpeg","-hide_banner","-i","all.wav","-af","silencedetect=n=-40dB:d=0.12","-f","null","-"],capture_output=True,text=True).stderr
st=None
for m in re.finditer(r"silence_(start|end): ([0-9.]+)",o):
    if m[1]=="start": st=float(m[2])
    elif st is not None: sil.append((st,float(m[2]))); st=None
p=0; spans=[]
for k,t in lines.items():
    target=norm(t); acc=""; s0=None; e=None; q=p
    while len(acc)<len(target) and q<len(W):
        s0=W[q][1] if s0 is None else s0; acc+=W[q][0]; e=W[q][2]; q+=1
    if acc!=target: print("not in take:",k,repr(acc[:40])); break
    spans.append([k,s0,e]); p=q
trim="silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,apad=pad_dur=0.15"
total=float(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0","all.wav"]))
cuts=[0.0]
for a,b in zip(spans,spans[1:]):
    best=[s for s in sil if s[1]>a[2]-0.3 and s[0]<b[1]+0.3]; s=max(best,key=lambda s:s[1]-s[0]); cuts.append((s[0]+s[1])/2)
if spans:
    a=spans[-1]; nxt=W[p][1] if p<len(W) else total
    best=[s for s in sil if s[1]>a[2]-0.3 and s[0]<nxt+0.3]; cuts.append((lambda s:(s[0]+s[1])/2)(max(best,key=lambda s:s[1]-s[0])) if best else total)
for j,(k,_,_) in enumerate(spans):
    subprocess.run(["ffmpeg","-loglevel","error","-y","-i","all.wav","-ss",str(cuts[j]),"-to",str(cuts[j+1]),"-af",trim,f"{k}.wav"],check=True)
done={k for k,_,_ in spans}
for k,t in lines.items():
    if k in done: continue
    tts(t,f"{k}-raw.wav"); got="".join(w[0] for w in words(f"{k}-raw.wav"))
    print("separate:",k,"ok" if got==norm(t) else "MISMATCH "+got)
    subprocess.run(["ffmpeg","-loglevel","error","-y","-i",f"{k}-raw.wav","-af",trim,f"{k}.wav"],check=True)
dur={k:round(float(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",f"{k}.wav"])),2) for k in lines}
json.dump(dur,open("durations.json","w")); print(dur, "total", round(sum(dur.values()),1))
