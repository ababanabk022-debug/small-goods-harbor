"""Deterministic embedded micro-surface maps for the portable harbor GLB.
These maps preserve fine material response in generic glTF viewers. They are
procedural approximations of the source bumps, not a bake of Cycles lighting.
"""
import struct,zlib
import numpy as np

SIZE=128
SPECS={
    'sand':{'uvScale':8.0,'normalScale':.34,'heightScale':.32,'seed':712},
    'rock':{'uvScale':2.6,'normalScale':.48,'heightScale':1.5,'seed':953},
    'soil':{'uvScale':3.4,'normalScale':.46,'heightScale':1.1,'seed':431},
    'wood':{'uvScale':3.0,'normalScale':.46,'heightScale':.95,'seed':235},
    'fabric':{'uvScale':13.0,'normalScale':.38,'heightScale':.44,'seed':862},
}

def kind_for_material(name):
    s=name.lower()
    if any(k in s for k in ['cutaway','geological','sediment','mineral soil','earth']):
        return 'soil'
    if any(k in s for k in ['wood','cedar','bark','sign board']):
        return 'wood'
    if any(k in s for k in ['linen','cotton','canvas','cloth']):
        return 'fabric'
    if 'sand' in s and 'sandstone' not in s:
        return 'sand'
    if any(k in s for k in ['rock','granite','stone']):
        return 'rock'
    return None

def tile_noise(size,fx,fy,seed):
    rng=np.random.default_rng(seed)
    grid=rng.random((fy,fx),dtype=np.float32)
    x=np.arange(size,dtype=np.float32)*fx/size
    y=np.arange(size,dtype=np.float32)*fy/size
    ix=np.floor(x).astype(np.int32);iy=np.floor(y).astype(np.int32)
    tx=x-ix;ty=y-iy
    tx=tx*tx*(3-2*tx);ty=ty*ty*(3-2*ty)
    a=grid[iy[:,None]%fy,ix[None,:]%fx]
    b=grid[iy[:,None]%fy,(ix[None,:]+1)%fx]
    c=grid[(iy[:,None]+1)%fy,ix[None,:]%fx]
    d=grid[(iy[:,None]+1)%fy,(ix[None,:]+1)%fx]
    return (a*(1-tx)+b*tx)*(1-ty[:,None])+(c*(1-tx)+d*tx)*ty[:,None]

def png_rgb(array):
    a=np.ascontiguousarray(np.clip(array,0,255).astype(np.uint8))
    h,w,c=a.shape
    assert c==3
    def chunk(kind,data):
        return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    data=b''.join(b'\x00'+a[row].tobytes() for row in range(h))
    return (b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+
            chunk(b'IDAT',zlib.compress(data,9))+chunk(b'IEND',b''))

def build_texture_pair(kind):
    spec=SPECS[kind];seed=spec['seed'];n=SIZE
    if kind=='sand':
        h=.52*tile_noise(n,61,59,seed)+.31*tile_noise(n,43,47,seed+1)+.17*tile_noise(n,17,19,seed+2)
    elif kind=='wood':
        h=.57*tile_noise(n,31,2,seed)+.26*tile_noise(n,53,5,seed+1)+.17*tile_noise(n,61,29,seed+2)
    elif kind=='fabric':
        h=.40*tile_noise(n,57,3,seed)+.40*tile_noise(n,3,59,seed+1)+.20*tile_noise(n,47,43,seed+2)
    elif kind=='soil':
        # Random, gently anisotropic mineral grain. No periodic sine bands.
        h=.40*tile_noise(n,7,5,seed)+.31*tile_noise(n,29,11,seed+1)+.29*tile_noise(n,59,47,seed+2)
    else:
        h=.45*tile_noise(n,5,7,seed)+.32*tile_noise(n,19,23,seed+1)+.23*tile_noise(n,59,53,seed+2)
    dx=(np.roll(h,-1,axis=1)-np.roll(h,1,axis=1))*spec['heightScale']
    dy=(np.roll(h,-1,axis=0)-np.roll(h,1,axis=0))*spec['heightScale']
    normals=np.stack((-dx,-dy,np.ones_like(h)),axis=-1)
    normals/=np.linalg.norm(normals,axis=-1,keepdims=True)
    normal_rgb=np.rint((normals*.5+.5)*255)
    # G contains roughness; B is 1 so it does not add metal to the source material.
    rough=np.empty((n,n,3),np.float32);rough[:]=255
    rough[:,:,1]=np.rint((.88+.12*np.clip(h,0,1))*255)
    return png_rgb(normal_rgb),png_rgb(rough)
