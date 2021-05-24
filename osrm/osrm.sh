#!/bin/bash

# chkconfig: 345 20 80
# description: Builds and runs OSRM

# This script builds OSRM Planet
# It will create builds for 3 profiles; car, bike, foot
# There is not any backup as of yet

# Source function library.
. /etc/init.d/functions

VERSION=5.24.0
FILENAME=planet-latest
PROFILES=( car bicycle foot )
PROFILE=car
SOURCE_URL=https://github.com/Project-OSRM/osrm-backend/archive/refs/tags/v${VERSION}.tar.gz
PLANET_URL=https://planet.openstreetmap.org/pbf/$FILENAME.osm.pbf

build() {
        set -x
        set -e

        # Make swap space. We'll leave this behind
        if ! $(swapon | grep -q /swap); then 
                fallocate -l 100G /swap
                chmod 600 /swap
                mkswap /swap
                swapon /swap
        fi

        # do the updates
        sudo apt-get update

        # Get OSRM build deps
        sudo apt-get install -y git g++ cmake libboost-dev libboost-filesystem-dev libboost-thread-dev \
        libboost-system-dev libboost-regex-dev libxml2-dev libsparsehash-dev libbz2-dev \
        zlib1g-dev libzip-dev libgomp1 liblua5.3-dev \
        pkg-config libgdal-dev libboost-program-options-dev libboost-iostreams-dev \
        libboost-test-dev libtbb-dev libexpat1-dev

        # Download and install OSRM

        # Create a working directory
        if [ ! -d osrm ]; then
          mkdir osrm
        fi

        # Get present directory
        cd osrm
        PWD=`pwd`

        # Download and extract osrm
        if [ ! -d osrm-backend-$VERSION ]; then
                wget $SOURCE_URL
                tar zxvf v${VERSION}.tar.gz
        fi

        # Build OSRM
        if [ ! -d osrm-backend-$VERSION/build ]; then
                cd osrm-backend-$VERSION
                mkdir -p build
                cd build
                cmake .. -DCMAKE_BUILD_TYPE=Release
                cmake --build .
                sudo cmake --build . --target install
        fi

        # Download and build OSM dataset
        cd $PWD

        # Get the planet file if needed
        if [ ! -f $FILENAME.osm.pbf ]; then
                wget $PLANET_URL
        fi

        # make a data dir
        if [ ! -d $FILENAME-data ]; then
                mkdir $FILENAME-data
        fi
        
         for profile in ${PROFILES[@]}; do
                if [ -d $FILENAME-data/$profile ]; then
                        echo "$FILENAME-data/$profile already exists...skipping"
                        continue
                fi

                # make a directory for the profile
                mkdir -p $FILENAME-data/$profile

                # extract the planet data for each profile
                osrm-extract $FILENAME.osm.pbf -p osrm-backend-$VERSION/profiles/$profile.lua
                # Uncomment if using traffic updates
                # https://github.com/Project-OSRM/osrm-backend/wiki/Running-OSRM
                osrm-partition $FILENAME.osrm
                osrm-customize $FILENAME.osrm

                # Comment out if using traffic updates above
                osrm-contract $FILENAME.osrm

                # move the generated files to its own profile dir
                mv $FILENAME.osrm* $FILENAME-data/$profile/
        done
}

# start the osrm-routed process (port 5000)
start() {
        cd /root/osrm/$FILENAME-data/$PROFILE
        osrm-routed $FILENAME.osrm &
        echo $? > /var/run/osrm.pid
}

# stop the osrm-routed process
stop() {
        if [ ! -f /var/run/osrm.pid ]; then
                return
        fi
        kill `cat /var/run/osrm.pid`
        rm /var/run/osrm.pid
}

case "$1" in
        build)
        build
        ;;
        start)
        start
        ;;
        stop)
        stop
        ;;
        *)
        echo "$0 {build|start|stop}"
        ;;
esac
