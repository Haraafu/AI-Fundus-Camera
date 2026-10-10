"""Resume the official Mendeley V1 archive, keeping progress outside Git."""
import json
import time
import urllib.request
from pathlib import Path

URL='https://data.mendeley.com/public-api/zip/6ry9n79gb4/download/1'
ROOT=Path(__file__).resolve().parents[2]
DEST=ROOT/'data/mendeley/6ry9n79gb4-v1.zip'

def main():
    DEST.parent.mkdir(parents=True,exist_ok=True)
    partial=DEST.with_suffix('.zip.part')
    with urllib.request.urlopen(urllib.request.Request(URL,method='HEAD',headers={'User-Agent':'Mozilla/5.0'}),timeout=60) as r:
        total=int(r.headers['Content-Length'])
    if DEST.exists():
        if DEST.stat().st_size != total: raise ValueError('Existing archive has unexpected size')
        print('Archive already downloaded:',DEST); return
    for attempt in range(8):
        offset=partial.stat().st_size if partial.exists() else 0
        if offset==total:
            partial.replace(DEST); print('Download complete:',DEST,flush=True); return
        if offset>total: raise ValueError('Partial file exceeds expected archive size')
        headers={'User-Agent':'Mozilla/5.0'}
        if offset: headers['Range']=f'bytes={offset}-'
        try:
            with urllib.request.urlopen(urllib.request.Request(URL,headers=headers),timeout=120) as response:
                if offset and response.status!=206:
                    raise RuntimeError('Server does not support resume. Preserve partial file for inspection.')
                last=0
                with partial.open('ab' if offset else 'wb') as out:
                    while chunk:=response.read(1024*1024):
                        out.write(chunk); offset+=len(chunk)
                        if time.monotonic()-last>15:
                            progress={'downloaded_bytes':offset,'total_bytes':total,'percent':round(offset/total*100,2)}
                            (DEST.parent/'download-progress.json').write_text(json.dumps(progress))
                            print(json.dumps(progress),flush=True);last=time.monotonic()
        except RuntimeError: raise
        except Exception as error:
            print(f'Attempt {attempt+1}: {type(error).__name__}',flush=True)
            time.sleep(min(10,attempt+1))
    if partial.stat().st_size==total:
        partial.replace(DEST); print('Download complete:',DEST,flush=True);return
    raise RuntimeError('Download incomplete. Rerun to resume.')

if __name__=='__main__': main()
